"""Alignment uses measured IRAF a-key centers, not mouse coordinates."""
import tempfile
import unittest
from pathlib import Path
import numpy as np
from astropy.io import fits
from giraf.alignment import measure_alignment_star, parse_imexam_center
from giraf.task_capabilities import installed_root

class CenterLogTests(unittest.TestCase):
    def test_measured_center_and_failed_measurements(self):
        self.assertEqual(parse_imexam_center('# COL LINE\n32.24 30.76 32.24 30.76 13.92 12.25 125664 100 5006\n'), (32.24, 30.76))
        for text in ['', '# header only', 'INDEF 30.76 0 0 0 0 1 100 2', '32 31 32 31 1 INDEF 0 100 0']:
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_imexam_center(text)

@unittest.skipUnless(installed_root(), 'IRAF required')
class AlignmentCenterTests(unittest.TestCase):
    def test_real_iraf_centers_are_subpixel_repeatable_and_originals_are_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'star.fits'
            y,x = np.mgrid[:64,:64]
            fits.writeto(path, 100 + 5000*np.exp(-((x-31.25)**2+(y-29.75)**2)/8))
            original = path.read_bytes()
            row = dict(id='star', path=str(path), name=path.name, label=path.name, asset='image')
            for backend in ('cl', 'pyraf'):
                with self.subTest(backend=backend):
                    a = measure_alignment_star(row, 32, 31, backend)
                    b = measure_alignment_star(row, 33, 30, backend)
                    self.assertAlmostEqual(a[0],32.25,delta=.05)
                    self.assertAlmostEqual(a[1],30.75,delta=.05)
                    self.assertAlmostEqual(a[0],b[0],delta=.05)
                    self.assertAlmostEqual(a[1],b[1],delta=.05)
                    self.assertNotEqual(a,(32,31))
                    self.assertEqual(path.read_bytes(),original)
            for point in [(0,1),(65,2),(float('nan'),2)]:
                with self.assertRaises(ValueError): measure_alignment_star(row,*point,'cl')
