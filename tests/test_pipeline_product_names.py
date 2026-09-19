"""Downstream image lists retain distinct names across independent runs."""
import unittest
from giraf.generic_tasks import preview_generic


class PipelineProductNamesTests(unittest.TestCase):
    def test_alignment_outputs_from_separate_runs_use_product_labels(self):
        manifest = {
            'definition': {
                'inputs': [{'name': 'input'}],
                'outputs': [{'name': 'output', 'kind': 'image', 'mode': 'each'}],
            },
            'inputs': {'input': ['b1', 'b2', 'v1']},
            'outputs': {'output': 'al'},
            'rows': [
                {'id': 'b1', 'name': 'o00000.fits', 'label': 'ptarget_B90_1.fits'},
                {'id': 'b2', 'name': 'o00000.fits', 'label': 'ptarget_B90_2.fits'},
                {'id': 'v1', 'name': 'o00000.fits', 'label': 'ptarget_V60_1.fits'},
            ],
        }
        previews = preview_generic(manifest)
        self.assertEqual([p['output'] for p in previews], [
            'alptarget_B90_1.fits', 'alptarget_B90_2.fits', 'alptarget_V60_1.fits',
        ])
        self.assertEqual([p['source'] for p in previews], ['b1', 'b2', 'v1'])

    def test_raw_input_without_label_uses_filename(self):
        manifest = {
            'definition': {'inputs': [{'name': 'input'}], 'outputs': [{'name': 'output', 'kind': 'image', 'mode': 'each'}]},
            'inputs': {'input': ['raw']}, 'outputs': {'output': 'p'},
            'rows': [{'id': 'raw', 'name': 'target_B90_1.fits'}],
        }
        self.assertEqual(preview_generic(manifest)[0]['output'], 'ptarget_B90_1.fits')
