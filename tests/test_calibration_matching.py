"""CCD jobs use native IRAF parameters without application calibration routing."""
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
from astropy.io import fits
from giraf.task_jobs import validate_task
from giraf.generic_tasks import GenericTaskRun
from giraf.task_worker import TaskRun

OFF = {key:'no' for key in ('fixpix','overscan','trim','zerocor','darkcor','flatcor','illumcor','fringecor','readcor','scancor')}
LEGACY = {'matching':'metadata','group':'exposure','overrides':[{'group':{'exposure':15},'parameters':{'combine':'average'},'output':'changed.fits'}]}

class NativeCalibrationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.rows={}
        for name,exposure in [('a',15),('b',30)]:
            path=self.root/(name+'.fits');fits.writeto(path,np.ones((24,32),dtype='float32'),fits.Header({'EXPTIME':exposure,'SUBSET':'B'}))
            self.rows[name]=dict(id=name,path=str(path),name=path.name,label=path.name,asset='image')
    def tearDown(self): self.temp.cleanup()
    def prepare(self,payload):
        manifest=validate_task(payload,self.rows.__getitem__)
        job=self.root/'job';job.mkdir();(job/'manifest.json').write_text(json.dumps(manifest))
        run=(GenericTaskRun if manifest.get('adapter')=='generic' else TaskRun)(job);run.prepare()
        return manifest,run,job
    def test_dark_is_one_native_combine_without_split_or_overrides(self):
        m,run,job=self.prepare(dict(task='darkcombine',inputs={'input':['a','b']},parameters={'process':'no','combine':'median','ccdtype':''},output={'name':'Dark.fits'},calibration=LEGACY))
        self.assertNotIn('exposureGroups',m);self.assertNotIn('calibrationPlan',m)
        self.assertEqual(len(run.calls),1);self.assertEqual(run.calls[0][1]['combine'],'median')
        self.assertEqual(run.calls[0][1]['process'],'no')
        for path in (job/'input').glob('*.fits'): self.assertNotIn('FILTER',fits.getheader(path))
    def test_process_is_left_to_native_combine(self):
        m,run,_=self.prepare(dict(task='flatcombine',inputs={'input':['a','b']},parameters={'process':'yes','subsets':'yes','ccdtype':''},ccdproc=OFF,output={'name':'Flat.fits'},calibration=LEGACY))
        self.assertNotIn('calibrationPlan',m);self.assertEqual(len(run.calls),1)
        self.assertEqual(run.calls[0][0],'flatcombine');self.assertEqual(run.calls[0][1]['process'],'yes');self.assertEqual(run.calls[0][1]['subsets'],'yes')
    def test_ccdproc_is_single_native_call_and_headers_are_unchanged(self):
        m,run,job=self.prepare(dict(task='ccdproc',inputs={'images':['a','b']},parameters=dict(OFF,ccdtype=''),outputs={'output':'p_'},calibration=LEGACY))
        self.assertNotIn('calibrationPlan',m);self.assertEqual(len(run.calls),1)
        self.assertTrue(run.calls[0][0]['images'].startswith('@'))
        for path in (job/'input').glob('*.fits'): self.assertNotIn('FILTER',fits.getheader(path))
    def test_multiple_master_candidates_are_not_automatically_selected(self):
        with self.assertRaises(ValueError):
            validate_task(dict(task='ccdproc',inputs={'images':['a'],'dark':['a','b']},parameters=dict(OFF,darkcor='yes',ccdtype=''),outputs={'output':'p_'},calibration={'matching':'metadata'}),self.rows.__getitem__)
