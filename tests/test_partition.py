import tempfile
import unittest
from pathlib import Path

import numpy as np
from astropy.io import fits

from giraf.model import inspect_file


class PartitionTests(unittest.TestCase):
    def test_inspect_file_reports_partition_headers(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'flat.fits'
            fits.writeto(path, np.zeros((4, 4), dtype='float32'), fits.Header(dict(FILTER=' B ', EXPTIME=12.5, OBJECT='M42', NCOMBINE=5)))
            headers = inspect_file(path)['headers']
        self.assertEqual(headers, {'FILTER': 'B', 'EXPTIME': '12.5', 'OBJECT': 'M42', 'NCOMBINE': '5'})


if __name__ == '__main__':
    unittest.main()
