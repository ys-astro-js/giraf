"""The viewer consumes daoedit's seven native a-key columns unchanged."""
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
class DaoeditTests(unittest.TestCase):
    def test_both_backends_emit_native_measurements_and_preserve_source(self):
        spec = discover()['tasks']['noao.digiphot.daophot.daoedit']
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            y, x = np.mgrid[:96, :96]
            path = root / 'star.fits'
            fits.writeto(path, (100 + 5000 * np.exp(-((x-47.25)**2+(y-45.75)**2)/8)).astype('float32'))
            original = path.read_bytes()
            row = dict(id='star', name=path.name, label=path.name, path=str(path), asset='image')
            outputs = []
            for backend in ('cl', 'pyraf'):
                payload = dict(backend=backend, inputs={'image': ['star']}, cursorCommands={'icommands': '48 47 1 a\n0 0 1 q\n'})
                manifest = validate_generic(spec, payload, lambda _: row)
                job = root / backend
                job.mkdir()
                (job / 'manifest.json').write_text(json.dumps(manifest))
                GenericTaskRun(job).execute()
                self.assertEqual(json.loads((job / 'status.json').read_text())['state'], 'completed', (job / 'task.log').read_text())
                product = next(p for p in json.loads((job / 'products.json').read_text()) if p['role'] == '$stdout')
                output = (job / product['file']).read_text()
                self.assertIn('XCENTER YCENTER', output)
                fields = next(line.split() for line in output.splitlines() if line.strip() and not line.startswith('#'))
                self.assertEqual(len(fields), 7)
                values = list(map(float, fields))
                self.assertAlmostEqual(values[0], 48.25, delta=.05)
                self.assertAlmostEqual(values[1], 46.75, delta=.05)
                self.assertAlmostEqual(values[2], 100, delta=1)
                self.assertGreater(values[4], 0)
                self.assertGreater(values[5], 0)
                outputs.append(fields)
                self.assertEqual(path.read_bytes(), original)
            self.assertEqual(outputs[0], outputs[1])

    def test_one_run_keeps_every_star_and_its_value_outputs_list_them(self):
        from giraf.values import task_value
        spec = discover()['tasks']['noao.digiphot.daophot.daoedit']
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            y, x = np.mgrid[:128, :128]
            stars = [(5000, 30.25, 40.75, 1.5), (3000, 90.5, 30.5, 2.0), (8000, 60, 100, 2.5)]
            image = 100 + sum(a * np.exp(-((x-cx)**2+(y-cy)**2)/(2*s*s)) for a, cx, cy, s in stars)
            path = root / 'star.fits'
            fits.writeto(path, image.astype('float32'))
            row = dict(id='star', name=path.name, label=path.name, path=str(path), asset='image')
            keys = ''.join(f'{round(cx) + 1} {round(cy) + 1} 1 a\n' for _, cx, cy, _ in stars)
            payload = dict(backend='cl', inputs={'image': ['star']}, cursorCommands={'icommands': keys + '0 0 1 q\n'})
            manifest = validate_generic(spec, payload, lambda _: row)
            job = root / 'job'
            job.mkdir()
            (job / 'manifest.json').write_text(json.dumps(manifest))
            GenericTaskRun(job).execute()
            self.assertEqual(json.loads((job / 'status.json').read_text())['state'], 'completed', (job / 'task.log').read_text())
            products = [dict(p, path=str(job / p['file'])) for p in json.loads((job / 'products.json').read_text())]
            run = dict(state='completed', manifest=manifest, products=products)
            fwhm = task_value(run, 'fwhm', lambda _: None)
            self.assertEqual(len(fwhm['values']), 3)
            # Wider stars measure wider, in the order they were picked.
            self.assertEqual(fwhm['values'], sorted(fwhm['values']))
            self.assertEqual(len(task_value(run, 'sky', lambda _: None)['values']), 3)
