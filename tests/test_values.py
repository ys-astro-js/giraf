"""Value connections: value outputs, value nodes and their resolution (giraf/values.py)."""
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from astropy.io import fits

from giraf.values import (ValueGraph, apply_parameters, column_values, evaluate_expression,
                          parameter_value, table_records)
from giraf.workflow import execute_workflow, workflow_order

DAOEDIT = '# XCENTER YCENTER       SKY SKYSIGMA    FWHM   COUNTS     MAG\n' \
          '  1624.10 1077.09     832.5    13.51    8.28  18473.3 -10.666\n' \
          '  1100.00  900.00     830.0    13.00    8.00  10000.0 -10.000\n'
APPHOT = '#K IRAF = x\n#N IMAGE               XINIT     YINIT     ID    COORDS    LID    \\\n' \
         '#U imagename           pixels    pixels    ##    filename  ##     \\\n' \
         '#N XCENTER    YCENTER    MAG     \\\n#U pixels     pixels     mag     \\\n' \
         'm67v.fits  10.0  20.0  1  c.coo  1  \\\n   10.5  20.5  14.25  \n' \
         'm67v.fits  30.0  40.0  2  c.coo  2  \\\n   30.5  40.5  INDEF  \n'


class TableTests(unittest.TestCase):
    def test_plain_header_column_by_name_or_index(self):
        self.assertEqual(column_values(DAOEDIT, 'fwhm'), [8.28, 8.0])
        self.assertEqual(column_values(DAOEDIT, 1), [1624.1, 1100.0])
        with self.assertRaises(ValueError):
            column_values(DAOEDIT, 'NOPE')

    def test_apphot_records_continue_names_and_values(self):
        names, rows = table_records(APPHOT)
        self.assertEqual(names[-3:], ['XCENTER', 'YCENTER', 'MAG'])
        self.assertEqual(len(rows), 2)
        # INDEF is not a number; it is left out of a real value.
        self.assertEqual(column_values(APPHOT, 'MAG'), [14.25])
        self.assertEqual(column_values(APPHOT, 'IMAGE', 'string'), ['m67v.fits', 'm67v.fits'])


class ExpressionTests(unittest.TestCase):
    def test_aggregates_and_elementwise_arithmetic(self):
        v = {'fwhm': [3.0, 4.0, 5.0], 'gain': [1.5]}
        self.assertEqual(evaluate_expression('median(fwhm) * 4', v), [16.0])
        self.assertEqual(evaluate_expression('fwhm + 1', v), [4.0, 5.0, 6.0])
        self.assertEqual(evaluate_expression('gain * 2', v), [3.0])
        self.assertAlmostEqual(evaluate_expression('stddev(fwhm)', v)[0], 1.0)
        self.assertEqual(evaluate_expression('max(fwhm) > 4 && min(fwhm) >= 3', v), [True])
        for bad in ('__import__("os")', 'fwhm.real', 'open(1)', 'nope + 1', '1 +'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                evaluate_expression(bad, v)

    def test_parameter_value_needs_one_value_and_follows_partition(self):
        result = dict(kind='real', values=[3.38, 3.07], groups=dict(keyword='FILTER', values={'B': [3.38], 'V': [3.07]}))
        self.assertEqual(parameter_value(result, {'keyword': 'FILTER', 'value': 'V'}, 'r'), 3.07)
        with self.assertRaisesRegex(ValueError, '2개'):
            parameter_value(result, None, 'r')
        self.assertEqual(parameter_value(dict(values=[4.0]), None, 'i'), 4)
        self.assertEqual(parameter_value(dict(values=[True]), None, 'b'), 'yes')
        self.assertEqual(parameter_value(dict(values=[3.0, 3.0]), None, 's'), '3')


class GraphTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.files = {}
        for name, band, ncombine in (('b.fits', 'B', 3), ('v.fits', 'V', 5)):
            path = self.root / name
            header = fits.Header({'FILTER': band, 'NCOMBINE': ncombine})
            fits.PrimaryHDU(np.zeros((2, 2), dtype=np.float32), header=header).writeto(path)
            self.files[name] = str(path)
        (self.root / 'daoedit.txt').write_text(DAOEDIT)

    def job(self):
        return dict(state='completed', manifest=dict(definition=dict(values=[
            dict(name='fwhm', kind='real', **{'from': '$stdout'}, column='FWHM')])),
            products=[dict(id='p1', role='$stdout', asset='text', path=str(self.root / 'daoedit.txt'))])

    def test_task_header_constant_and_compute_nodes(self):
        request = dict(nodes=[
            dict(id='gain', run='value-constant', rows=[dict(name='gain', value='1.4')]),
            dict(id='fw', run='value-constant', partition='FILTER',
                 rows=[dict(name='fwhm', value='', groups={'B': '3.38', 'V': '3.07'})]),
            dict(id='head', run='value-header', partition='FILTER', rows=[dict(name='NCOMBINE', value='')],
                 files=['b.fits', 'v.fits']),
            dict(id='calc', run='value-compute', rows=[dict(name='m', value='median(fwhm) * 4'),
                                                         dict(name='n', value='gain * NCOMBINE')],
                 inputs={'fwhm': dict(node='edit', output='fwhm'), 'gain': dict(node='gain', output='gain'),
                         'NCOMBINE': dict(node='head', output='NCOMBINE')}),
        ], links=[
            dict(id='l1', target='phot', parameter='datapars.fwhmpsf', type='r', source=dict(node='calc', output='m')),
            dict(id='l2', target='phot', parameter='datapars.epadu', type='r', source=dict(node='calc', output='n'),
                 partition=dict(keyword='FILTER', value='V')),
            dict(id='l3', target='phot', parameter='photpars.apertures', type='s', source=dict(node='fw', output='fwhm'),
                 partition=dict(keyword='FILTER', value='B')),
        ])
        graph = ValueGraph(request, lambda id: self.job() if id == 'edit' else None, lambda id: self.files[id])
        resolved = graph.parameters('phot')
        self.assertAlmostEqual(resolved['l1']['value'], 8.14 * 4)
        self.assertAlmostEqual(resolved['l2']['value'], 7.0)
        self.assertEqual(resolved['l3']['value'], '3.38')
        self.assertEqual(graph.dependencies('phot'), {'edit'})
        payload = apply_parameters({'parameters': {}, 'parameterSets': {}}, request['links'], resolved)
        self.assertAlmostEqual(payload['parameterSets']['datapars']['epadu'], 7.0)
        missing = ValueGraph(request, lambda id: None, lambda id: self.files[id]).parameters('phot')
        self.assertIn('실행', missing['l1']['error'])

    def test_workflow_orders_value_sources_and_writes_parameters(self):
        graph = dict(nodes=[dict(id='phot', label='phot', payload=dict(task='phot', parameters={}, parameterSets={})),
                            dict(id='edit', label='daoedit', payload=dict(task='daoedit'))],
                     links=[], values=dict(nodes=[dict(id='calc', run='value-compute', rows=[dict(name='m', value='mean(fwhm)')],
                                                       inputs={'fwhm': dict(node='edit', output='fwhm')})],
                                           links=[dict(id='l', target='phot', parameter='datapars.fwhmpsf', type='r',
                                                       source=dict(node='calc', output='m'))]))
        self.assertEqual(workflow_order(graph), ['edit', 'phot'])
        seen = {}

        def run(node, payload):
            seen[node['id']] = payload
            return self.job() if node['id'] == 'edit' else dict(state='completed', products=[])
        state = execute_workflow(graph, run, lambda: False, lambda s: None, lambda id: id)
        self.assertEqual(state['state'], 'completed', state['message'])
        self.assertAlmostEqual(seen['phot']['parameterSets']['datapars']['fwhmpsf'], 8.14)


class SchemaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        pkg = self.root / 'pkg' / 'demo'
        pkg.mkdir(parents=True)
        (pkg / 'demo.cl').write_text('package demo\ntask measure = "demo$x.e"\ntask datapars = "demo$datapars.par"\nclbye()\n')
        (pkg / 'measure.par').write_text('image,f,a,"",,,Input images\noutput,f,h,"",,,Output table\n'
                                         'sigma,r,h,2.5,0,10,Noise\ndatapars,pset,h,"",,,Data\nmode,s,h,ql\n')
        (pkg / 'datapars.par').write_text('fwhmpsf,r,h,2.5,0,,FWHM\nexposure,s,h,"",,,Exposure keyword\nmode,s,h,ql\n')
        self.schemas = self.root / 'schemas'
        self.schemas.mkdir()

    def spec(self, data, task='demo.measure'):
        (self.schemas / 'x.json').write_text(json.dumps({'version': 2, 'task': task, **data}))
        from giraf.task_discovery import discover
        return discover(self.root, schema_directories=[('giraf', self.schemas)])['tasks'][task]

    def test_pinned_connectable_and_value_outputs(self):
        s = self.spec({'pinned': ['datapars.fwhmpsf', 'sigma', 'nope'],
                       'parameters': {'datapars.exposure': {'connectable': False}},
                       'components': [{'type': 'value-output', 'name': 'fwhm', 'from': 'output', 'column': 'FWHM'}]})
        self.assertTrue(s['runnable'], s['reason'])
        self.assertEqual(s['pinned'], ['datapars.fwhmpsf', 'sigma'])
        self.assertTrue(any('nope' in i['message'] for i in s['schemaIssues']))
        self.assertEqual(s['values'], [dict(name='fwhm', kind='real', column='FWHM', **{'from': 'output'})])
        exposure = next(p for g in s['parameterSets'] for p in g['parameters'] if p['name'] == 'exposure')
        self.assertIs(exposure['connectable'], False)

    def test_malformed_value_fields_fail_closed(self):
        for data in ({'pinned': 'sigma'}, {'pinned': ['a b']},
                     {'parameters': {'sigma': {'connectable': 'no'}}},
                     {'components': [{'type': 'value-output', 'name': 'f', 'from': 'output'}]},
                     {'components': [{'type': 'value-output', 'name': 'f', 'from': 'output', 'column': 'A', 'keyword': 'B'}]},
                     {'components': [{'type': 'value-output', 'name': 'f', 'from': 'output', 'column': 0}]},
                     {'components': [{'type': 'value-output', 'name': 'f', 'kind': 'complex', 'from': 'output', 'column': 1}]},
                     {'components': [{'type': 'value-constant'}]}):
            with self.subTest(data=data):
                self.assertFalse(self.spec(data)['runnable'])

    def test_value_nodes_are_giraf_nodes_with_one_run_component(self):
        for run in ('value-constant', 'value-header', 'value-compute', 'pset'):
            with self.subTest(run=run):
                node = self.spec({'title': run, 'components': [{'type': run}]}, 'giraf.values')
                self.assertTrue(node['runnable'], node['reason'])
                self.assertEqual(node['run'], run)
        self.assertFalse(self.spec({'pinned': ['x'], 'components': [{'type': 'value-constant'}]}, 'giraf.values')['runnable'])
        self.assertFalse(self.spec({'components': [{'type': 'value-output', 'name': 'f', 'from': 'x', 'column': 1}]},
                                   'giraf.values')['runnable'])


if __name__ == '__main__':
    unittest.main()
