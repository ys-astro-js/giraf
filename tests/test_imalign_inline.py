"""DS9-free alignment contracts, written before implementation."""
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
from astropy.io import fits
from giraf.generic_tasks import validate_generic, GenericTaskRun
from giraf.task_discovery import discover
from giraf.task_capabilities import installed_root

@unittest.skipUnless(installed_root(), 'IRAF required')
class InlineAlignmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = discover()['tasks']['images.immatch.imalign']

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.rows = {}
        y,x = np.mgrid[:64,:64]
        for name, dx, dy in [('a',0,0),('b',8,-5)]:
            path=self.root/f'{name}.fits'
            fits.writeto(path,(100+5000*np.exp(-((x-31-dx)**2+(y-31-dy)**2)/8)+3000*np.exp(-((x-17-dx)**2+(y-43-dy)**2)/8)).astype('float32'))
            self.rows[name]=dict(id=name,name=path.name,label=path.name,path=str(path),asset='image')
        self.payload=dict(inputs={'input':['a','b'],'reference':['a']},textInputs={'coords':'32 32\n18 44\n','shifts':'0 0\n-8 5\n'},parameters={'interp_type':'nearest'})

    def validate(self):
        return validate_generic(self.spec,self.payload,self.rows.__getitem__)

    def test_inline_tables_are_preserved_staged_and_run_without_display_both_backends(self):
        for backend in ('cl','pyraf'):
            with self.subTest(backend=backend):
                self.payload['backend']=backend
                manifest=self.validate()
                self.assertEqual(manifest['textInputs'],self.payload['textInputs'])
                job=self.root/backend;job.mkdir();(job/'manifest.json').write_text(json.dumps(manifest))
                runner=GenericTaskRun(job);runner.execute()
                self.assertEqual(json.loads((job/'status.json').read_text())['state'],'completed',(job/'task.log').read_text())
                self.assertEqual((job/'lists/coords.txt').read_text(),'32 32\n18 44\n')
                self.assertEqual((job/'lists/shifts.txt').read_text(),'0 0\n-8 5\n')
                products=json.loads((job/'products.json').read_text())
                images=[fits.getdata(job/p['file']) for p in products if p['role']=='output']
                self.assertEqual(len(images),2)
                self.assertEqual(images[0].shape,images[1].shape)
                self.assertEqual(np.unravel_index(images[0].argmax(),images[0].shape),np.unravel_index(images[1].argmax(),images[1].shape))
                self.assertEqual(fits.getdata(self.rows['a']['path']).shape,(64,64))

    def test_invalid_tables_and_conflicting_sources_are_rejected(self):
        for records in ['NaN 3','1 inf','0 3','1','1 2 3','1 2\ninvalid','\x00']:
            with self.subTest(records=records):
                self.payload['textInputs']['coords']=records
                with self.assertRaisesRegex(ValueError,'coords'):self.validate()
        self.payload['textInputs']['coords']='32 32'
        self.payload['textInputs']['shifts']='0 0'
        with self.assertRaisesRegex(ValueError,'shifts'):self.validate()
        self.payload['textInputs']['shifts']='0 0\n-8 5'
        self.payload['expressions']={'coords':'some.txt'}
        with self.assertRaisesRegex(ValueError,'coords'):self.validate()

    def test_optional_shifts_and_unknown_roles(self):
        self.payload['textInputs']['shifts']=''
        self.assertEqual(self.validate()['textInputs']['shifts'],'')
        self.payload['textInputs']['output']='x'
        with self.assertRaises(ValueError):self.validate()

    def test_stale_image_binding_rejected(self):
        self.payload['alignmentBinding']={'reference':['a'],'input':['a','b']}
        self.validate()
        self.payload['inputs']['input']=['b','a']
        with self.assertRaisesRegex(ValueError,'다시'):self.validate()
