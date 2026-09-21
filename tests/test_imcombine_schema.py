"""Regression contracts for metadata classification, written before the fix."""
import json
from pathlib import Path
import tempfile
import unittest

from giraf.task_capabilities import installed_root
from giraf.task_discovery import discover
from giraf.generic_tasks import GenericTaskRun, validate_generic
from giraf.task_schema import parameter_profile


class CombineSchemaTests(unittest.TestCase):
    def test_settings_are_not_files_and_rejected_count_is_not_a_scalar_operand(self):
        prompts = ['Image scaling', 'Image zero point offset', 'Image weights',
                   'Input image offsets', 'Mask value']
        def par(name, prompt):
            return dict(name=name, type='s', mode='h', default='', choices=[], prompt=prompt)
        profile = parameter_profile([par(str(i), p) for i, p in enumerate(prompts)])['profile']
        self.assertEqual(profile['inputs'], [])
        profile = parameter_profile([par('counts', 'Optional output pixel masks giving the number of input pixels rejected')])['profile']
        self.assertEqual(profile['inputs'], [])
        self.assertEqual(profile['outputs'][0]['name'], 'counts')
        self.assertNotIn('scalar', profile['outputs'][0])

    @unittest.skipUnless(installed_root(), 'IRAF required')
    def test_discovery_and_old_empty_drafts_execute_on_both_backends(self):
        import numpy as np
        from astropy.io import fits
        task = discover()['tasks']['images.immatch.imcombine']
        self.assertTrue(task['runnable'], task['reason'])
        self.assertEqual([s['name'] for s in task['inputs']], ['input'])
        self.assertIn('nrejmasks', [s['name'] for s in task['outputs']])
        again = discover()['tasks'][task['name']]
        self.assertEqual(task, again)
        for backend in ('cl', 'pyraf'):
            for project in ('no', 'yes'):
                with self.subTest(backend=backend, project=project), tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    data = np.arange(64, dtype=np.float32).reshape(8, 8)
                    rows = {}
                    for i, key in enumerate(('a', 'b')):
                        pixels = data + i * 10
                        if project == 'yes':
                            pixels = np.stack([pixels, pixels + 4])
                        fits.writeto(root/(key+'.fits'), pixels)
                        rows[key] = dict(id=key, name=key+'.fits', path=str(root/(key+'.fits')), asset='image')
                    payload = dict(backend=backend, inputs={'input':['a','b'], 'nrejmasks':[], 'headers':[], 'scale':[]},
                                   parameters={'nrejmasks':'', 'bpmasks':'', 'rejmasks':'', 'scale':'none', 'project':project},
                                   outputs={'output':'combined.fits' if project == 'no' else 'projected_'})
                    manifest = validate_generic(task, payload, rows.__getitem__)
                    self.assertEqual(manifest['outputs']['nrejmasks'], '')
                    job=root/'job'; job.mkdir(); (job/'manifest.json').write_text(json.dumps(manifest))
                    runner=GenericTaskRun(job); runner.execute()
                    self.assertEqual(json.loads((job/'status.json').read_text())['state'], 'completed', (job/'task.log').read_text())
                    products=[p for p in json.loads((job/'products.json').read_text()) if p['role']=='output']
                    self.assertEqual(len(products), 1 if project == 'no' else 2)
                    for i, product in enumerate(products):
                        np.testing.assert_allclose(fits.getdata(job/product['file']), data + (5 if project == 'no' else 2+i*10))
                    masked = validate_generic(task, dict(payload, outputs={**payload['outputs'], 'nrejmasks':'rejected.pl' if project == 'no' else 'rejected_'}), rows.__getitem__)
                    mask_job = root/'masked'; mask_job.mkdir()
                    (mask_job/'manifest.json').write_text(json.dumps(masked))
                    GenericTaskRun(mask_job).execute()
                    self.assertEqual(json.loads((mask_job/'status.json').read_text())['state'], 'completed', (mask_job/'task.log').read_text())
                    masks = [p for p in json.loads((mask_job/'products.json').read_text()) if p['role']=='nrejmasks']
                    self.assertEqual(len(masks), 1 if project == 'no' else 2)
                    with self.assertRaises(ValueError):
                        validate_generic(task, dict(payload, inputs={'input':['a'], 'nrejmasks':['a']}), rows.__getitem__)
