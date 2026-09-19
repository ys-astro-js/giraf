"""Acceptance contracts written before the task-map implementation.

All IRAF experiments use synthetic FITS and temporary directories. No classroom
file is changed. Backend permutations are intentional scientific regression tests.
"""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import numpy as np
from astropy.io import fits
from giraf import server
from giraf.jobs import ROOT, atomic_json
from giraf.task_catalog import catalog, parameters
from giraf.task_jobs import validate_task
from giraf.task_worker import TaskRun, checksum
from test_workspace import request

OFF={k:'no' for k in ('fixpix','overscan','trim','zerocor','darkcor','flatcor','illumcor','fringecor','readcor','scancor')}

class TaskMapTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.rows={};self.seq=0
    def tearDown(self):self.tmp.cleanup()
    def frame(self,name,value,kind='object',**header):
        path=self.root/name
        a=np.full((12,16),value,dtype='float32') if np.isscalar(value) else np.asarray(value,dtype='float32')
        fits.writeto(path,a,fits.Header(dict(IMAGETYP=kind,EXPTIME=10,DARKTIME=10,FILTER='R',**header)))
        r=server.register(path);self.rows[r['id']]=r;return r['id']
    def text(self,name,value):
        path=self.root/name;path.write_text(value);r=server.register(path);self.rows[r['id']]=r;return r['id']
    def manifest(self,task,ids,params=None,**extra):
        from giraf.task_catalog import TASKS
        p=dict(task=task,backend='cl',inputs={TASKS[task]['inputs'][0]['name']:ids},parameters=params or {},ccdproc=OFF,workingDirectory=str(self.root))
        for k,v in extra.items():
            if k=='inputs':p[k].update(v)
            else:p[k]=v
        return validate_task(p,self.rows.__getitem__)
    def launch(self,m,interactive=False):
        self.seq+=1;job=self.root/f'job{self.seq}';job.mkdir();atomic_json(job/'manifest.json',m)
        proc=subprocess.Popen([sys.executable,'-m','giraf.task_worker',str(job)],cwd=job,env=dict(os.environ,PYTHONPATH=str(ROOT),PYRAF_NO_DISPLAY='1'),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        return job,proc
    def run_m(self,m):
        job,proc=self.launch(m)
        try:proc.wait(timeout=45)
        except BaseException:proc.kill();proc.wait();raise
        status=json.loads((job/'status.json').read_text())
        self.assertIn(status['state'],('completed','skipped','partial'),(status,(job/'task.log').read_text(errors='replace')))
        return job,json.loads((job/'products.json').read_text())
    def images(self,job,products):return [job/p['file'] for p in products if p['asset']=='image']

    def test_installed_capabilities_and_full_parameter_exposure(self):
        c=catalog();self.assertIn('capabilities',c)
        self.assertIn('interactive',{p['name'] for p in parameters('ccdproc')})
        self.assertTrue({'logfile','plotfile','backup','ssfile','graphics','cursor'}<={p['name'] for p in parameters('ccdred')})
        self.assertIn('schemaFingerprint',c['capabilities'])
        self.assertIn('clobber',json.dumps(c['capabilities']))

    def test_expressions_lists_sections_duplicates_and_safety(self):
        from giraf.task_expressions import resolve_expression
        a=self.frame('a.fits',10);b=self.frame('b.fits',20)
        self.text('ordered.list','b.fits[1:4,1:3]\na.fits\nb.fits[1:4,1:3]\n')
        found=resolve_expression('@ordered.list',str(self.root))
        self.assertEqual([Path(r['path']).name for r in found],['b.fits','a.fits','b.fits'])
        self.assertEqual(found[0]['section'],'[1:4,1:3]')
        self.assertEqual(len(resolve_expression('*.fits',str(self.root))),2)
        for expr in ('!touch injected','a.fits\n!touch injected','a.fits;!touch injected'):
            with self.assertRaises(ValueError):resolve_expression(expr,str(self.root))
        self.assertFalse((self.root/'injected').exists())
        m=self.manifest('combine',[a,b,a]);self.assertEqual(m['inputs']['input'],[a,b,a])
        job,p=self.run_m(self.manifest('imstatistics',[],expressions={'images':'a.fits[1:4,1:3]'}))
        self.assertIn('10',(job/'task.log').read_text())

    def test_preprocessor_package_snapshot_and_auxiliary_files(self):
        a=self.frame('dark.fits',10,'dark')
        m=self.manifest('darkcombine',[a],{'process':'yes','reject':'none'},ccdred={'logfile':'custom.log','plotfile':'overscan.gki','backup':'bak_'},instanceId='draft-a')
        job,p=self.run_m(m)
        effective=json.loads((job/'effective.json').read_text())
        self.assertEqual(effective['requested']['instanceId'],'draft-a')
        self.assertEqual(effective['requested']['ccdred']['logfile'],'custom.log')
        self.assertEqual(effective['requested']['ccdproc']['zerocor'],'no')
        self.assertTrue((job/'custom.log').exists())
        self.assertTrue(json.loads((job/'sources.json').read_text())[0]['sha256'])

    def test_real_scale_offsets_masks_projection_and_sections(self):
        a=self.frame('one.fits',10);b=self.frame('two.fits',20)
        scale=self.text('scale.txt','1\n2\n');off=self.text('offsets.txt','0 0\n0 0\n')
        for backend in ('cl','pyraf'):
            m=self.manifest('combine',[a,b],{'scale':'@scale.txt','sigma':'noise.fits','plfile':'rejected.pl'},backend=backend,inputs={'offsets':[off]})
            job,p=self.run_m(m);self.assertGreaterEqual(len(p),4)
            image=next(job/q['file'] for q in p if q['label']=='Combined.fits')
            self.assertTrue(np.allclose(fits.getdata(image),fits.getdata(image)[0,0]))
            cube=self.frame(f'cube-{backend}.fits',np.stack([np.full((12,16),4),np.full((12,16),8)]))
            job,p=self.run_m(self.manifest('combine',[cube],{'project':'yes'},backend=backend))
            np.testing.assert_allclose(fits.getdata(self.images(job,p)[0]),6)
            mask=self.frame(f'mask-{backend}.fits',np.pad(np.ones((1,1)),((0,11),(0,15))))
            masked=self.frame(f'masked-{backend}.fits',np.pad(np.array([[999.]]),((0,11),(0,15)),constant_values=10),BPM=self.rows[mask]['path'])
            job,p=self.run_m(self.manifest('combine',[masked,b],{'masktype':'badvalue','maskvalue':1},backend=backend))
            self.assertEqual(fits.getdata(self.images(job,p)[0])[0,0],20)
            self.assertIn('BPM',(job/'references.json').read_text())

    def test_header_diff_delete_return_and_original_preservation(self):
        a=self.frame('header.fits',10,ZEROCOR='old record');before=checksum(self.rows[a]['path'])
        for backend in ('cl','pyraf'):
            job,p=self.run_m(self.manifest('ccdhedit',[a],{'parameter':'zerocor','value':''},backend=backend))
            self.assertNotIn('ZEROCOR',fits.getheader(self.images(job,p)[0]))
            diff=json.loads((job/'header-diff.json').read_text())
            self.assertTrue(any(x['key']=='ZEROCOR' and x['after'] is None for x in diff))
            self.assertEqual(checksum(self.rows[a]['path']),before)

    def test_processed_skipped_partial_failure_and_no_fake_products(self):
        good=self.frame('good.fits',100);wrong=self.frame('zero.fits',10,'zero')
        zero=self.frame('master.fits',10,'zero');bad=self.frame('bad.fits',np.ones((20,30)))
        job,p=self.run_m(self.manifest('ccdproc',[wrong],OFF))
        outcomes=json.loads((job/'outcomes.json').read_text());self.assertEqual(outcomes[0]['state'],'skipped')
        self.assertFalse(self.images(job,p))
        job,p=self.run_m(self.manifest('ccdproc',[good,bad],dict(OFF,zerocor='yes'),inputs={'zero':[zero]}))
        self.assertEqual(json.loads((job/'status.json').read_text())['state'],'partial')
        outcomes=json.loads((job/'outcomes.json').read_text());self.assertEqual([x['state'] for x in outcomes],['processed','failed'])
        self.assertEqual(len(self.images(job,p)),1)

    def test_output_paths_direct_backup_conflicts_and_changed_source(self):
        a=self.frame('original.fits',100);before=checksum(self.rows[a]['path'])
        target=self.root/'named.fits'
        job,p=self.run_m(self.manifest('combine',[a],output={'name':str(target)}))
        self.assertFalse(target.exists())
        self.assertEqual(checksum(self.rows[a]['path']),before)
        m=self.manifest('ccdhedit',[a],{'parameter':'OBSERVER','value':'test'},filePolicy={'mode':'direct','backup':True})
        self.assertTrue(m['filePlan']['destructive'])
        with self.assertRaisesRegex(ValueError,'확인|승인'):
            from giraf.task_jobs import authorize_file_plan
            authorize_file_plan(m,None)
        authorize_file_plan(m,m['filePlan']['token'])
        job,p=self.run_m(m)
        self.assertEqual(fits.getheader(self.rows[a]['path'])['OBSERVER'],'test')
        self.assertTrue(list((job/'backup').glob('*')))
        stale=self.manifest('combine',[a])
        fits.setval(self.rows[a]['path'],'OBSERVER',value='changed')
        job,proc=self.launch(stale)
        try:proc.wait(timeout=30)
        finally:
            if proc.poll() is None:proc.kill();proc.wait()
        self.assertEqual(json.loads((job/'status.json').read_text())['state'],'failed')
        with self.assertRaisesRegex(ValueError,'clobber'):
            self.manifest('combine',[a],{'clobber':'yes'})

    def test_interactive_fitting_resume_graphics_and_cancellation(self):
        a=self.frame('overscan.fits',np.tile(np.arange(12)[:,None],(1,16))+100)
        for backend in ('pyraf','cl'):
            m=self.manifest('ccdproc',[a],dict(OFF,overscan='yes',biassec='[13:16,1:12]',interactive='yes',function='legendre',order=1),backend=backend)
            job,proc=self.launch(m,True);answers=0;seen_graphics=False
            try:
                deadline=time.monotonic()+45
                while proc.poll() is None and time.monotonic()<deadline:
                    f=job/'interaction.json'
                    if f.exists():
                        q=json.loads(f.read_text())
                        response=job/'responses'/f"{q['id']}.json"
                        if q.get('state')=='waiting' and not response.exists():
                            seen_graphics|=q['kind']=='cursor'
                            response.parent.mkdir(exist_ok=True)
                            atomic_json(response,{'value':'0 0 1 q' if q['kind']=='cursor' else 'yes'})
                            answers+=1
                    time.sleep(.05)
                self.assertIsNotNone(proc.poll(),'interactive process did not finish')
                state=json.loads((job/'status.json').read_text())
                self.assertEqual(state['state'],'completed',(state,(job/'task.log').read_text(errors='replace')))
                self.assertTrue(seen_graphics);self.assertGreater(answers,0)
                self.assertIn('<svg',(job/'interactive.svg').read_text())
            finally:
                if proc.poll() is None:proc.kill();proc.wait()
        m=self.manifest('ccdproc',[a],dict(OFF,overscan='yes',biassec='[13:16,1:12]',interactive='yes'),backend='pyraf')
        job,proc=self.launch(m)
        try:
            deadline=time.monotonic()+20
            while not (job/'interaction.json').exists() and proc.poll() is None and time.monotonic()<deadline:time.sleep(.05)
            (job/'cancel').write_text('cancel')
            proc.wait(timeout=8)
            self.assertEqual(json.loads((job/'status.json').read_text())['state'],'cancelled')
        finally:
            if proc.poll() is None:proc.kill();proc.wait()

    def test_api_map_persistence_header_and_error_navigation(self):
        a=self.frame('api.fits',5)
        with patch.object(server,'STATE',self.root/'workspace.json'),patch.object(server,'workspace',{'folder':str(self.root),'sets':[],'overrides':{}}):
            graph={'version':1,'tasks':[{'id':'instance','task':'combine'}],'connections':[],'view':{'selected':'instance','mode':'list','zoom':1.25}}
            code,_=asyncio.run(request('POST','task-preferences',{'taskMap':graph}));self.assertEqual(code,200)
            code,data=asyncio.run(request('GET','task-preferences'));self.assertEqual(data['taskMap'],graph)
            code,data=asyncio.run(request('GET','header',query=f'id={a}'));self.assertEqual(code,200);self.assertTrue(any(c['key']=='IMAGETYP' for c in data['cards']))
            code,data=asyncio.run(request('POST','task-validate',{'task':'ccdproc','inputs':{'images':[a]}}))
            self.assertEqual(code,400);self.assertTrue(data['issues'][0]['field'])
