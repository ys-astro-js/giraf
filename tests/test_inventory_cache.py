import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from astropy.io import fits

from giraf import server


class InventoryCacheTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.raw = self.root / 'raw'
        self.raw.mkdir()
        self.runs = self.root / 'runs'
        self.runs.mkdir()
        self.image = self.raw / 'science.fits'
        fits.writeto(self.image, np.ones((2, 2)), fits.Header({'IMAGETYP': 'LIGHT', 'FILTER': 'R'}))
        self.state = {'folder': str(self.raw), 'sets': [], 'overrides': {}}
        for name, value in [('workspace', self.state), ('registry', {}), ('RUNS', self.runs)]:
            replacement = patch.object(server, name, value)
            replacement.start()
            self.addCleanup(replacement.stop)

    def test_one_inspection_per_unchanged_original_and_product(self):
        job = self.runs / 'job'
        job.mkdir()
        fits.writeto(job / 'result.fits', np.ones((2, 2)))
        (job / 'status.json').write_text(json.dumps({'state': 'completed'}))
        (job / 'manifest.json').write_text(json.dumps({'workspace_folder': str(self.raw)}))
        (job / 'products.json').write_text(json.dumps([{'file': 'result.fits', 'label': 'Result', 'asset': 'image'}]))
        with patch.object(fits, 'open', wraps=fits.open) as opened:
            first = server.files()
            self.assertEqual(opened.call_count, 2)
            self.assertEqual(server.files(), first)
            self.assertEqual(opened.call_count, 2)
        self.assertEqual(first[1]['label'], 'Result')
        self.assertEqual(first[1]['group'], 'results')

    def test_metadata_edits_and_returned_rows_do_not_contaminate_cache(self):
        first = server.files()[0]
        self.state['overrides'][first['id']] = {'kind': 'flat', 'filter': 'B'}
        first['history']['NCOMBINE'] = '99'
        edited = server.files()[0]
        self.assertEqual((edited['group'], edited['filter']), ('flat', 'B'))
        self.assertNotIn('NCOMBINE', edited['history'])
        self.state['overrides'].clear()
        self.assertEqual(server.files()[0]['filter'], 'R')

    def test_same_size_replacement_with_preserved_mtime_is_reinspected(self):
        before = server.files()[0]
        stat = self.image.stat()
        replacement = self.raw / 'replacement.tmp'
        fits.writeto(replacement, np.ones((2, 2)), fits.Header({'IMAGETYP': 'LIGHT', 'FILTER': 'B'}))
        os.utime(replacement, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        replacement.replace(self.image)
        self.assertEqual(self.image.stat().st_size, stat.st_size)
        after = server.files()[0]
        self.assertEqual(after['id'], before['id'])
        self.assertEqual(after['filter'], 'B')
        self.image.unlink()
        self.assertEqual(server.files(), [])
        self.image.write_bytes(b'broken FITS')
        self.assertTrue(server.files()[0]['error'])
        self.image.unlink()
        fits.writeto(self.image, np.ones((2, 2)), fits.Header({'FILTER': 'V'}))
        self.assertEqual(server.files()[0]['filter'], 'V')

    def test_in_place_header_change_is_reinspected(self):
        self.assertEqual(server.files()[0]['filter'], 'R')
        with fits.open(self.image, mode='update') as hdus:
            hdus[0].header['FILTER'] = 'I'
        self.assertEqual(server.files()[0]['filter'], 'I')
