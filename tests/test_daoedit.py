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
