"""Task-editor requests exercised against both actual IRAF launchers."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from astropy.io import fits

from giraf.jobs import ROOT, atomic_json
from giraf.server import register
from giraf.task_jobs import validate_task
from giraf.task_worker import checksum


NO_CORRECTIONS={k:'no' for k in ('fixpix','overscan','trim','zerocor','darkcor','flatcor','illumcor','fringecor','readcor','scancor')}


class TaskTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.rows={}
        self.sequence=0

    def tearDown(self):self.tmp.cleanup()

    def frame(self,name,value,kind='zero',filter='',exposure=10):
        path=self.root/name
        array=np.full((24,32),value,dtype='float32') if np.isscalar(value) else value.astype('float32')
        fits.writeto(path,array,fits.Header({'IMAGETYP':kind,'FILTER':filter,'EXPTIME':exposure,'DARKTIME':exposure}))
        row=register(path);self.rows[row['id']]=row
        return row['id']

    def run_task(self,task,ids,params=None,backend='cl',extra=None):
        from giraf.task_catalog import TASKS
        role=TASKS[task]['inputs'][0]['name']
        payload=dict(task=task,backend=backend,inputs={role:ids},parameters=params or {},ccdproc=dict(NO_CORRECTIONS))
        for k,v in (extra or {}).items():
            if k in ('inputs','parameters','ccdproc'):payload[k].update(v)
            else:payload[k]=v
        m=validate_task(payload,self.rows.__getitem__)
        self.sequence+=1
        job=self.root/f'run{self.sequence}';job.mkdir()
        atomic_json(job/'manifest.json',m)
        r=subprocess.run([sys.executable,'-m','giraf.task_worker',str(job)],cwd=job,
                         env=dict(os.environ,PYTHONPATH=str(ROOT),PYRAF_NO_DISPLAY='1'),capture_output=True,text=True,timeout=45)
        if r.returncode:raise AssertionError(r.stdout+r.stderr)
        products=json.loads((job/'products.json').read_text())
        for p in products:
            row=register(job/p['file'],p['label'],job.name,p.get('asset'));self.rows[row['id']]=row;p['id']=row['id']
        return job,products

    def test_variable_count_and_recombine_both_backends(self):
        ids=[self.frame(f'bias {i}.fits',v) for i,v in enumerate([10,12,100])]
        before={i:checksum(self.rows[i]['path']) for i in ids}
        outputs=[]
        for backend in ('cl','pyraf'):
            job,p=self.run_task('zerocombine',ids,dict(combine='median',reject='none'),backend)
            np.testing.assert_array_equal(fits.getdata(job/p[0]['file']),12.)
            outputs.append(p[0]['id'])
        job,p=self.run_task('combine',outputs,dict(combine='average'))
        np.testing.assert_array_equal(fits.getdata(job/p[0]['file']),12.)
        self.assertEqual(before,{i:checksum(self.rows[i]['path']) for i in ids})

    def test_dark_preprocess_flat_subsets_and_science_mapping(self):
        zero=self.frame('zero.fits',10)
        darks=[self.frame(f'dark{i}.fits',30+i,'dark') for i in (-1,0,1)]
        job,p=self.run_task('darkcombine',darks,dict(combine='median',reject='none',scale='none'),extra=dict(
            inputs={'zero':[zero]},ccdproc={'zerocor':'yes'}))
        np.testing.assert_array_equal(fits.getdata(job/p[0]['file']),20.)
        dark=p[0]['id']
        flats=[self.frame(f'flat_{f}_{i}.fits',v+i,'flat',f) for f,v in [('B',100),('V',200)] for i in (-1,0,1)]
        job,p=self.run_task('flatcombine',flats,dict(process='no',combine='median',reject='none',scale='none'))
        images=[v for v in p if v['asset']=='image']
        self.assertEqual({v['label'] for v in images},{'FlatB.fits','FlatV.fits'})
        science=[self.frame(f'science{i}.fits',130+i,'object','B') for i in (0,1)]
        job,p=self.run_task('ccdproc',science,dict(NO_CORRECTIONS,zerocor='yes',darkcor='yes'),extra={'inputs':{'zero':[zero],'dark':[dark]},'output':{'name':'cal_'}})
        images=[v for v in p if v['asset']=='image']
        self.assertEqual([v['label'] for v in images],['cal_science0.fits','cal_science1.fits'])
        for i,v in enumerate(images):np.testing.assert_array_equal(fits.getdata(job/v['file']),100.+i)

    def test_ccdhedit_preserves_source_and_updates_header(self):
        id=self.frame('unknown.fits',123,'unknown')
        original=checksum(self.rows[id]['path'])
        for backend in ('cl','pyraf'):
            job,p=self.run_task('ccdhedit',[id],dict(parameter='subset',value='B'),backend)
            self.assertEqual(fits.getheader(job/p[0]['file'])['FILTER'],'B')
            self.assertEqual(checksum(self.rows[id]['path']),original)

    def test_badpiximage_pixels_and_dryrun(self):
        id=self.frame('flat.fits',np.arange(24*32).reshape(24,32)+100,'flat','B')
        text=self.root/'bad.txt';text.write_text('1 2 1 2\n')
        row=register(text);self.rows[row['id']]=row
        job,p=self.run_task('badpiximage',[row['id']],extra={'inputs':{'template':[id]}})
        image=fits.getdata(job/p[0]['file'])
        self.assertEqual(image[0,0],0)
        self.assertEqual(image[10,10],1)
        job,p=self.run_task('ccdproc',[id],dict(NO_CORRECTIONS,noproc='yes'))
        self.assertFalse(any(row['asset']=='image' for row in p))

    def test_preflight_and_cl_quoting(self):
        id=self.frame('raw.fits',1)
        with self.assertRaisesRegex(ValueError,'zero'):
            validate_task(dict(task='ccdproc',inputs={'images':[id]}),self.rows.__getitem__)
        with self.assertRaises(ValueError):
            validate_task(dict(task='ccdhedit',inputs={'images':[id]},parameters={'parameter':'bad; delete','value':'x'}),self.rows.__getitem__)
        value='a "quoted" value; harmless'
        job,p=self.run_task('ccdhedit',[id],dict(parameter='OBSERVER',value=value))
        self.assertEqual(fits.getheader(job/p[0]['file'])['OBSERVER'],value)
