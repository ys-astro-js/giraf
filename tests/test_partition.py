import tempfile
import unittest
from pathlib import Path

import numpy as np
from astropy.io import fits

from giraf.model import inspect_file
from giraf.request_schema import WorkflowRequest
from giraf.workflow import execute_workflow


class PartitionTests(unittest.TestCase):
    def test_inspect_file_reports_partition_headers(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'flat.fits'
            fits.writeto(path, np.zeros((4, 4), dtype='float32'), fits.Header(dict(FILTER=' B ', EXPTIME=12.5, OBJECT='M42', NCOMBINE=5)))
            headers = inspect_file(path)['headers']
        self.assertEqual(headers, {'FILTER': 'B', 'EXPTIME': '12.5', 'OBJECT': 'M42', 'NCOMBINE': '5'})

    def test_links_filter_products_by_source_partition(self):
        graph = {'nodes': [{'id': x, 'label': x, 'payload': {'task': 'fake', 'inputs': {}, 'parameters': {}}} for x in ['a', 'b']],
                 'links': [{'source': 'a', 'target': 'b', 'role': 'flat', 'kind': 'image', 'multiple': True,
                            'sourcePartition': {'keyword': 'FILTER', 'value': 'B'}}]}
        WorkflowRequest.model_validate(graph)
        calls = []
        def run(node, payload):
            calls.append(payload)
            return {'id': node['id'], 'state': 'completed', 'products': [
                {'id': 'v', 'asset': 'image', 'headers': {'FILTER': 'V'}},
                {'id': 'b', 'asset': 'image', 'headers': {'FILTER': 'B'}},
                {'id': 'none', 'asset': 'image', 'headers': {}}]}
        self.assertEqual(execute_workflow(graph, run, lambda: False, lambda s: None)['state'], 'completed')
        self.assertEqual(calls[-1]['inputs'], {'flat': ['b']})
        graph['links'][0]['sourcePartition'] = {'keyword': 'FILTER', 'value': ''}
        calls.clear()
        execute_workflow(graph, run, lambda: False, lambda s: None)
        self.assertEqual(calls[-1]['inputs'], {'flat': ['none']})


if __name__ == '__main__':
    unittest.main()
