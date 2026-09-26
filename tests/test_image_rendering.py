"""Viewer contracts at the HTTP handler boundary, before responsibility extraction."""
import asyncio
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from astropy.io import fits
from PIL import Image
from starlette.requests import Request

from giraf import server


class ImageRenderingTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / 'image.fits'
        self.enterContext(patch.object(server, 'registry', {'image': {'path': str(self.path)}}))

    def response(self, handler, query=''):
        request = Request({'type': 'http', 'query_string': ('id=image&' + query).encode()})
        return asyncio.run(handler(request))

    def test_statistics_ignore_nonfinite_pixels_and_keep_header(self):
        fits.writeto(self.path, np.array([[0., 1.], [2., np.nan]]), fits.Header({'OBJECT': 'target'}))
        data = json.loads(self.response(server.info_endpoint).body)
        self.assertEqual((data['width'], data['height']), (2, 2))
        self.assertEqual((data['mean'], data['median'], data['min'], data['max']), (1., 1., 0., 2.))
        self.assertEqual(sum(data['histogram']), 1)
        self.assertIn('target', data['header'])

    def test_png_preserves_native_size_and_flips_detector_rows(self):
        fits.writeto(self.path, np.array([[0., 1., 2.], [3., 4., 5.]]))
        response = self.response(server.image_endpoint, 'low=0&high=5&stretch=linear')
        self.assertEqual(response.media_type, 'image/png')
        with Image.open(io.BytesIO(response.body)) as image:
            self.assertEqual(image.size, (3, 2))
            np.testing.assert_array_equal(np.asarray(image), [[153, 204, 255], [0, 51, 102]])

    def test_pixel_coordinates_are_one_based_and_nonfinite_values_are_null(self):
        fits.writeto(self.path, np.array([[np.nan, 1.], [np.inf, 3.]]))
        data = json.loads(self.response(server.pixel_endpoint, 'x=1&y=1').body)
        self.assertEqual(data, {'x': 1, 'y': 1, 'value': None, 'row': [None, 1.], 'column': [None, None]})
        with self.assertRaisesRegex(ValueError, '영상 밖'):
            self.response(server.pixel_endpoint, 'x=0&y=1')

    def test_invalid_dimensions_empty_statistics_and_display_limits_remain_errors(self):
        fits.writeto(self.path, np.array([1., 2.]))
        with self.assertRaisesRegex(ValueError, '2D'):
            self.response(server.info_endpoint)
        fits.writeto(self.path, np.full((2, 2), np.nan), overwrite=True)
        with self.assertRaisesRegex(ValueError, '유효한 픽셀'):
            self.response(server.info_endpoint)
        with self.assertRaisesRegex(ValueError, '상한'):
            self.response(server.image_endpoint, 'low=1&high=1')
