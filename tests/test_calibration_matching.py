"""CCD jobs use native IRAF parameters without application calibration routing."""
import tempfile
import unittest
from pathlib import Path
import numpy as np
from astropy.io import fits
from giraf.task_jobs import validate_task

OFF = {key:'no' for key in ('fixpix','overscan','trim','zerocor','darkcor','flatcor','illumcor','fringecor','readcor','scancor')}

class NativeCalibrationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.rows={}
        for name,exposure in [('a',15),('b',30)]:
            path=self.root/(name+'.fits');fits.writeto(path,np.ones((24,32),dtype='float32'),fits.Header({'EXPTIME':exposure,'SUBSET':'B'}))
            self.rows[name]=dict(id=name,path=str(path),name=path.name,label=path.name,asset='image')
    def tearDown(self): self.temp.cleanup()
    def test_multiple_master_candidates_are_not_automatically_selected(self):
        with self.assertRaises(ValueError):
            validate_task(dict(task='ccdproc',inputs={'images':['a'],'dark':['a','b']},parameters=dict(OFF,darkcor='yes',ccdtype=''),outputs={'output':'p_'},calibration={'matching':'metadata'}),self.rows.__getitem__)
