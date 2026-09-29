"""Execution status follows IRAF; per-star errors remain in its native table."""
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from astropy.io import fits

from giraf.generic_tasks import GenericTaskRun, validate_generic
from giraf.task_capabilities import installed_root
from giraf.task_discovery import discover


@unittest.skipUnless(installed_root(), 'IRAF required')
class PhotStatusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = discover()['tasks']['noao.digiphot.apphot.phot']

    def test_native_success_empty_measurement_errors_and_task_failure(self):
        for backend in ('cl', 'pyraf'):
            for case in ('normal', 'no_coords', 'bad_pixels', 'invalid_image'):
                with self.subTest(backend=backend, case=case), tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    y, x = np.mgrid[:64, :64]
                    data = (100 + 5000 * np.exp(-((x-31)**2 + (y-31)**2)/8)).astype('float32')
                    fits.writeto(root / 'star.fits', data)
                    if case == 'invalid_image':
                        (root / 'star.fits').write_text('Not a FITS image\n')
                    (root / 'coords.txt').write_text('32 32\n')
                    rows = {
                        'image': dict(id='image', name='star.fits', path=str(root / 'star.fits'), asset='image'),
                        'coords': dict(id='coords', name='coords.txt', path=str(root / 'coords.txt'), asset='text'),
                    }
                    sets = {'fitskypars': {'salgorithm': 'median'}, 'photpars': {'apertures': '5'}}
                    if case == 'bad_pixels':
                        sets['datapars'] = {'datamax': 1000}
                    payload = dict(backend=backend, inputs={'image': ['image'], 'coords': [] if case == 'no_coords' else ['coords']}, parameterSets=sets)
                    manifest = validate_generic(self.spec, payload, rows.__getitem__)
                    job = root / 'job'
                    job.mkdir()
                    (job / 'manifest.json').write_text(json.dumps(manifest))
                    runner = GenericTaskRun(job)
                    runner.execute()
                    log = (job / 'task.log').read_text()
                    status = json.loads((job / 'status.json').read_text())
                    products = json.loads((job / 'products.json').read_text())
                    tables = [p for p in products if p['role'] == 'output']
                    expected = 'failed' if case == 'invalid_image' else 'completed'
                    self.assertEqual(status['state'], expected, log)
                    outcomes = json.loads((job / 'outcomes.json').read_text())
                    self.assertEqual({o['state'] for o in outcomes}, {'failed' if expected == 'failed' else 'processed'})
                    if case == 'invalid_image':
                        self.assertIn('ERROR', log)
                        self.assertEqual(tables, [])
                    elif case == 'no_coords':
                        self.assertIn('GIRAF_GENERIC_DONE', log)
                        self.assertNotIn('ERROR', log)
                        self.assertEqual(tables, [])
                        self.assertIn('출력 파일이 없습니다', outcomes[0]['message'])
                    else:
                        self.assertEqual(len(tables), 1)
                        published = (job / tables[0]['file']).read_bytes()
                        self.assertEqual(published, (job / runner.expected[0]['file']).read_bytes())
                        if case == 'bad_pixels':
                            self.assertIn(b'305  BadPixels', published)
                            self.assertIn(b'INDEF  INDEF', published)
