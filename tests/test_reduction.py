"""Numerical end-to-end checks against real IRAF, plus preflight edge cases."""
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import unittest

import numpy as np
from astropy.io import fits

from giraf.jobs import ROOT, atomic_json
from giraf.model import Settings, scan, selected, validate
from giraf.worker import checksum


def fixture(folder, science_time=20.):
    yy, xx = np.mgrid[:24, :32]
    bias = 100. + xx * .125 + yy * .25
    response = 1. + (xx - 15.5) / 80.
    for i, noise in enumerate([-1., 0., 1.]):
        for kind, time, data, filt in [
            ('bias', 0., bias + noise, ''),
            ('dark', 10., bias + 2. * 10 + noise, ''),
            ('dark', 20., bias + 2. * 20 + noise, ''),
            ('flat', 10., bias + 20 + (1000 + noise * 100) * response, 'B'),
            ('flat', 10., bias + 20 + (1500 + noise * 100) * response[::-1, ::-1], 'V'),
        ]:
            h = fits.Header({'IMAGETYP': kind, 'EXPTIME': time, 'FILTER': filt,
                             'XBINNING': 1, 'YBINNING': 1, 'CCD-TEMP': -20.})
            fits.writeto(folder / f'{kind}_{filt}_{time:g}_{i}.fits', data.astype('float32'), h)
    for filt, resp in [('B', response), ('V', response[::-1, ::-1])]:
        h = fits.Header({'IMAGETYP': 'object', 'EXPTIME': science_time, 'FILTER': filt,
                         'XBINNING': 1, 'YBINNING': 1, 'CCD-TEMP': -20.})
        fits.writeto(folder / f'science_{filt}.fits', (bias + 2 * science_time + 500 * resp).astype('float32'), h)
    return bias


def run_job(folder, rows, settings, operation="reduction", name=""):
    folder.mkdir()
    atomic_json(folder / 'manifest.json', dict(rows=[r for r in rows if r.get('use')] if operation == 'combine' else selected(rows), settings=settings.to_dict(), operation=operation, name=name))
    env = os.environ.copy()
    env.update(PYRAF_NO_DISPLAY='1', PYTHONPATH=str(ROOT))
    result = subprocess.run([sys.executable, '-m', 'giraf.worker', str(folder)], cwd=folder,
                            env=env, capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)
    return json.loads((folder / 'products.json').read_text())


class ReductionTests(unittest.TestCase):
    def test_full_reduction_and_original_preservation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw = root / 'raw'; raw.mkdir()
            bias = fixture(raw)
            before = {str(p): checksum(p) for p in raw.glob('*.fits')}
            rows = scan(str(raw))
            self.assertEqual(validate(rows, Settings())[0], [])
            products = run_job(root / 'run', rows, Settings(flat_scale='mean'))
            for p in products:
                array = fits.getdata(root / 'run' / p['file'])
                if p['source']:
                    np.testing.assert_allclose(array, 500., atol=.002, rtol=0)
                    h = fits.getheader(root / 'run' / p['file'])
                    for key in ['ZEROCOR', 'DARKCOR', 'FLATCOR']:
                        self.assertIn(key, h)
                if p['label'] == 'Master bias':
                    np.testing.assert_array_equal(array, bias)
            self.assertEqual(before, {str(p): checksum(p) for p in raw.glob('*.fits')})
            self.assertEqual(len([p for p in products if p['source']]), 2)

    def test_dark_scaling(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); raw = root / 'raw'; raw.mkdir()
            fixture(raw, science_time=25.)
            rows = scan(str(raw))
            self.assertTrue(any('25s' in e for e in validate(rows, Settings())[0]))
            s = Settings(dark_policy='scale', flat_scale='mean')
            self.assertEqual(validate(rows, s)[0], [])
            for p in run_job(root / 'run', rows, s):
                if p['source']:
                    np.testing.assert_allclose(fits.getdata(root / 'run' / p['file']), 500., atol=.002, rtol=0)

    def test_geometry(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); raw = root / 'raw'; raw.mkdir()
            fixture(raw)
            for path in raw.glob('*.fits'):
                a, h = fits.getdata(path, header=True)
                overscan = np.repeat((100. + np.arange(24) * .25)[:, None], 4, axis=1)
                fits.writeto(path, np.concatenate([a, overscan], axis=1).astype('float32'), h, overwrite=True)
            s = Settings(flat_scale='mean', overscan=True, biassec='[33:36,1:24]', trim=True, trimsec='[1:32,1:24]')
            for p in run_job(root / 'run', scan(str(raw)), s):
                if p['source']:
                    a = fits.getdata(root / 'run' / p['file'])
                    self.assertEqual(a.shape, (24, 32))
                    np.testing.assert_allclose(a, 500., atol=.005, rtol=0)

    def test_resuming_partial_calibrations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); raw = root / 'raw'; raw.mkdir()
            fixture(raw)
            # Produce authentic IRAF partial frames, including geometry/mean metadata.
            original_rows = scan(str(raw))
            run_job(root / 'baseline', original_rows, Settings(flat_scale='mean'))
            for index, r in enumerate(selected(original_rows)):
                if r['kind'] in ('dark', 'flat'):
                    prepared = root / 'baseline' / 'prepared' / f"{r['kind']}{index:04d}.fits"
                    shutil.copy2(prepared, r['path'])
            rows = scan(str(raw))
            for r in rows:
                if r.get('resumable'):
                    r.update(use=True, kind=r['detected_kind'])
            s = Settings(resume=True, flat_scale='mean')
            for p in run_job(root / 'run', rows, s):
                if p['source']:
                    np.testing.assert_allclose(fits.getdata(root / 'run' / p['file']), 500., atol=.002, rtol=0)

    def test_minmax_average(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); raw = root / 'raw'; raw.mkdir()
            for i, value in enumerate([1., 2., 3., 4., 80.]):
                fits.writeto(raw / f'bias_{i}.fits', np.full((12, 12), value, dtype='float32'),
                             fits.Header({'IMAGETYP': 'bias', 'EXPTIME': 0.}))
            s = Settings(dark=False, flat=False, combine='average', reject='minmax', nlow=0, nhigh=1)
            run_job(root / 'run', scan(str(raw)), s)
            np.testing.assert_array_equal(fits.getdata(root / 'run/masters/bias.fits'), 2.5)

    def test_combine_existing_results(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); raw = root / 'raw'; raw.mkdir()
            for i, value in enumerate([3., 30.]):
                fits.writeto(raw / f'Zero{i}.fits', np.full((12,12), value, dtype='float32'),
                             fits.Header({'IMAGETYP':'bias','EXPTIME':0.,'NCOMBINE':5}))
            rows = scan(str(raw))
            for r in rows: r['use'] = True
            s = Settings(dark=False, flat=False, combine='average')
            run_job(root / 'run', rows, s, 'combine', 'Zero.fits')
            np.testing.assert_array_equal(fits.getdata(root / 'run/masters/result.fits'), 16.5)

    def test_reuse_master_calibrations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); raw = root / 'raw'; raw.mkdir()
            fixture(raw)
            run_job(root / 'baseline', scan(str(raw)), Settings(flat_scale='mean'))
            base = root / 'baseline/masters'
            s = Settings(master_bias=str(base / 'bias.fits'),
                         master_darks=[str(base / 'dark01.fits')],
                         master_flats=[str(base / 'flat00.fits'),str(base / 'flat01.fits')])
            rows=scan(str(raw))
            for r in rows: r['use'] = r['kind'] == 'science'
            self.assertEqual(validate(rows,s)[0], [])
            hashes={str(p):checksum(p) for p in base.glob('*.fits')}
            for p in run_job(root / 'run', rows, s):
                if p['source']:
                    np.testing.assert_allclose(fits.getdata(root / 'run' / p['file']), 500., atol=.002, rtol=0)
            self.assertEqual(hashes,{str(p):checksum(p) for p in base.glob('*.fits')})

    def test_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp); fixture(raw)
            rows = scan(str(raw))
            for r in rows:
                if r['kind'] == 'flat' and r['filter'] == 'B':
                    r['use'] = False
            self.assertTrue(any('B 필터' in e for e in validate(rows, Settings())[0]))
            self.assertTrue(any('minmax' in e for e in validate(scan(str(raw)), Settings(reject='minmax', nlow=2, nhigh=2))[0]))
            self.assertTrue(any('범위' in e for e in validate(scan(str(raw)), Settings(trim=True, trimsec='[1:100,1:24]'))[0]))
            file = next(raw.glob('bias*'))
            fits.setval(file, 'ZEROCOR', value='already reduced')
            rows = scan(str(raw))
            changed = next(r for r in rows if r['path'] == str(file.resolve()))
            self.assertFalse(changed['use'])
            changed.update(use=True, kind='bias')
            self.assertTrue(any('처리된' in e for e in validate(rows, Settings())[0]))

    def test_course_bias_split(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); raw = root / 'raw'; raw.mkdir()
            values = [1., 2., 3., 4., 80., 10., 20., 30., 40., 100.]
            for i, value in enumerate(values):
                fits.writeto(raw / f'bias_{i:02d}.fits', np.full((12, 12), value, dtype='float32'),
                             fits.Header({'IMAGETYP': 'bias', 'EXPTIME': 0.}))
            s = Settings(dark=False, flat=False, split_bias=True)
            run_job(root / 'run', scan(str(raw)), s)
            np.testing.assert_array_equal(fits.getdata(root / 'run/masters/bias.fits'), 16.5)


if __name__ == '__main__':
    unittest.main()
