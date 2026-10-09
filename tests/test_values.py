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

    def test_parameter_value_needs_one_value_and_follows_the_round(self):
        result = dict(kind='real', values=[3.38, 3.07], labels=[{'FILTER': 'B'}, {'FILTER': 'V'}])
        self.assertEqual(parameter_value(result, {'FILTER': 'V'}, 'r'), 3.07)
        with self.assertRaisesRegex(ValueError, '2개'):
            parameter_value(result, None, 'r')
        self.assertEqual(parameter_value(dict(values=[4.0]), None, 'i'), 4)
        self.assertEqual(parameter_value(dict(values=[True]), None, 'b'), 'yes')
        self.assertEqual(parameter_value(dict(values=[3.0, 3.0]), None, 's'), '3')

    def test_a_round_value_finds_its_label_as_a_number(self):
        # Labels keep the header's text; a round of 15 and a typed label of 15.0 are one.
        result = dict(kind='real', values=[1.0, 2.0], labels=[{'EXPTIME': '15.0'}, {'EXPTIME': '30'}])
        self.assertEqual(parameter_value(result, {'EXPTIME': '15'}, 'r'), 1.0)
        self.assertEqual(parameter_value(result, {'EXPTIME': '30.00'}, 'r'), 2.0)
        with self.assertRaisesRegex(ValueError, '60 회차에 맞는 값이 없습니다'):
            parameter_value(result, {'EXPTIME': '60.0'}, 'r')

    def test_a_region_member_run_alone_takes_its_first_round(self):
        # The editor gives a member's value links the region's first round (web/src/lib/values.ts).
        request = dict(nodes=[dict(id='fwhm', run='value-constant', partition='SUBSET',
                                   rows=[dict(name='fwhmpsf', value='', groups={'B': '3.38', 'V': '3.07'})])],
                       links=[dict(id='l1', target='phot', parameter='datapars.fwhmpsf', type='r',
                                   source=dict(node='fwhm', output='fwhmpsf'), round={'SUBSET': 'B'})])
        self.assertEqual(ValueGraph(request, lambda id: None, str).parameters('phot'), {'l1': {'value': 3.38}})
        del request['links'][0]['round']
        self.assertIn('2개', ValueGraph(request, lambda id: None, str).parameters('phot')['l1']['error'])


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
            dict(id='head', run='value-header', rows=[dict(name='NCOMBINE', value='')], files=['b.fits', 'v.fits']),
            dict(id='calc', run='value-compute', rows=[dict(name='m', value='median(fwhm) * 4'),
                                                         dict(name='n', value='gain * NCOMBINE')],
                 inputs={'fwhm': dict(node='edit', output='fwhm'), 'gain': dict(node='gain', output='gain'),
                         'NCOMBINE': dict(node='head', output='NCOMBINE')}),
        ], links=[
            dict(id='l1', target='phot', parameter='datapars.fwhmpsf', type='r', source=dict(node='calc', output='m')),
            dict(id='l2', target='phot', parameter='datapars.epadu', type='r', source=dict(node='calc', output='n')),
            dict(id='l3', target='phot', parameter='photpars.apertures', type='s', source=dict(node='fw', output='fwhm'),
                 round={'FILTER': 'B'}),
        ])
        graph = ValueGraph(request, lambda id: self.job() if id == 'edit' else None, lambda id: self.files[id])
        resolved = graph.parameters('phot')
        self.assertAlmostEqual(resolved['l1']['value'], 8.14 * 4)
        # Files read outside a region carry no labels: NCOMBINE is two values.
        self.assertIn('2개', resolved['l2']['error'])
        self.assertEqual(resolved['l3']['value'], '3.38')
        self.assertEqual(graph.dependencies('phot'), {'edit'})
        payload = apply_parameters({'parameters': {}, 'parameterSets': {}}, [request['links'][0]], resolved)
        self.assertAlmostEqual(payload['parameterSets']['datapars']['fwhmpsf'], 8.14 * 4)
        missing = ValueGraph(request, lambda id: None, lambda id: self.files[id]).parameters('phot')
        self.assertIn('실행', missing['l1']['error'])

    def test_values_carry_the_labels_of_their_files(self):
        labels = {'b': {'FILTER': 'B'}, 'v': {'FILTER': 'V'}, 'img-b': {'FILTER': 'B'}, 'img-v': {'FILTER': 'V'}}
        sel = dict(state='completed', manifest=dict(definition=dict(taskName='hselect', values=[
            dict(name='ncombine', kind='real', **{'from': 'output'}, keyword='NCOMBINE')])),
            products=[dict(id='b', role='output', path=self.files['b.fits'], labels=labels['b']),
                      dict(id='v', role='output', path=self.files['v.fits'], labels=labels['v'])])
        gain = dict(id='gain', run='value-constant', rows=[dict(name='gain', value='2')])
        calc = dict(id='calc', run='value-compute', rows=[dict(name='m', value='median(n) * gain')],
                    inputs={'n': dict(node='sel', output='ncombine'), 'gain': dict(node='gain', output='gain')})
        graph = ValueGraph(dict(nodes=[calc, gain]), {'sel': sel}.get, lambda id: self.files[id], labels.get)
        result = graph.outputs([dict(node='calc', output='m')])['calc:m']
        # Computed per label; a typed constant takes part in every one.
        self.assertEqual((result['values'], result['labels']), ([6.0, 10.0], [{'FILTER': 'B'}, {'FILTER': 'V'}]))
        # A header node reading a run's products keeps their labels.
        head = dict(id='head', run='value-header', rows=[dict(name='NCOMBINE', value='')], fileLinks=[dict(source='sel')])
        result = ValueGraph(dict(nodes=[head]), {'sel': sel}.get, lambda id: self.files[id]).output(dict(node='head', output='NCOMBINE'))
        self.assertEqual(result['labels'], [{'FILTER': 'B'}, {'FILTER': 'V'}])

    def test_table_rows_follow_the_image_their_product_came_from(self):
        (self.root / 'b.txt').write_text(DAOEDIT)
        (self.root / 'v.txt').write_text(DAOEDIT.replace('8.28', '3.00').replace('8.00', '3.50'))
        spec = dict(name='fwhm', kind='real', **{'from': '$stdout'}, column='FWHM')
        rows = [dict(id='img-b', path=self.files['b.fits']), dict(id='img-v', path=self.files['v.fits'])]
        labels = {'img-b': {'FILTER': 'B'}, 'img-v': {'FILTER': 'V'}}
        # daoedit runs over one image at a time; a per-image output (phot's .mag) names its input as `source`.
        daoedit = dict(state='completed', manifest=dict(rows=rows, definition=dict(taskName='daoedit', values=[spec])),
                       products=[dict(id='t1', role='$stdout', path=str(self.root / 'b.txt'), sourceInput='img-b'),
                                 dict(id='t2', role='$stdout', path=str(self.root / 'v.txt'), sourceInput='img-v')])
        phot = dict(daoedit, products=[dict(p, source=p['sourceInput'], sourceInput=None) for p in daoedit['products']])
        calc = dict(id='calc', run='value-compute', rows=[dict(name='m', value='median(fwhm)')],
                    inputs={'fwhm': dict(node='edit', output='fwhm')})
        for job in (daoedit, phot):
            with self.subTest(products=job['products']):
                graph = ValueGraph(dict(nodes=[calc]), {'edit': job}.get, str, lambda id: labels.get(id, {}))
                result = graph.output(dict(node='calc', output='m'))
                self.assertEqual((result['values'], result['labels']), ([8.14, 3.25], [{'FILTER': 'B'}, {'FILTER': 'V'}]))
        # A table made from both images at once has only the labels they share: none.
        mixed = dict(daoedit, products=[dict(id='t3', role='$stdout', path=str(self.root / 'b.txt'))])
        graph = ValueGraph(dict(nodes=[calc]), {'edit': mixed}.get, str, lambda id: labels.get(id, {}))
        self.assertNotIn('labels', graph.output(dict(node='calc', output='m')))

    def test_pset_node_rows_are_typed_values_and_follow_their_connections(self):
        pset = dict(id='datapars', run='pset', rows=[
            dict(name='readnoise', value='5.2', type='r'), dict(name='datamax', value='INDEF', type='r'),
            dict(name='emission', value='yes', type='b'), dict(name='nmax', value='3', type='i'),
            dict(name='filter', value='', type='s'), dict(name='fwhmpsf', value='2.5', type='r')],
            inputs={'fwhmpsf': dict(node='calc', output='m')})
        calc = dict(id='calc', run='value-compute', rows=[dict(name='m', value='median(fwhm) * 2')],
                    inputs={'fwhm': dict(node='edit', output='fwhm')})
        links = [dict(id=name, target='imcombine', parameter=name, type=type_, source=dict(node='datapars', output=source))
                 for name, type_, source in (('rdnoise', 's', 'readnoise'), ('high', 'r', 'datamax'),
                                             ('flag', 'b', 'emission'), ('n', 'i', 'nmax'), ('fw', 'r', 'fwhmpsf'))]
        graph = ValueGraph(dict(nodes=[pset, calc], links=links), lambda id: self.job() if id == 'edit' else None, str)
        outputs = graph.outputs([dict(node='datapars', output=n) for n in ('readnoise', 'emission', 'nmax', 'filter')])
        self.assertEqual([outputs[f'datapars:{n}'] for n in ('readnoise', 'emission', 'nmax', 'filter')], [
            dict(kind='real', values=[5.2]), dict(kind='bool', values=[True]),
            dict(kind='int', values=[3]), dict(kind='string', values=[''])])
        resolved = graph.parameters('imcombine')
        self.assertEqual({k: v['value'] for k, v in resolved.items()},
                         {'rdnoise': '5.2', 'high': 'INDEF', 'flag': 'yes', 'n': 3, 'fw': 8.14 * 2})
        # The upstream run feeds the forwarded row, so it orders first.
        self.assertEqual(graph.dependencies('imcombine'), {'edit'})
        # A pset row fed (through a compute node) by its own pset row is a cycle.
        loop = dict(calc, inputs={'fwhm': dict(node='datapars', output='fwhmpsf')})
        error = ValueGraph(dict(nodes=[pset, loop], links=links), lambda id: None, str).parameters('imcombine')['fw']['error']
        self.assertEqual(error, '값 연결이 순환합니다.')
        # Another row of the same pset may feed it: no value reads itself.
        across = dict(calc, rows=[dict(name='m', value='readnoise * 2')], inputs={'readnoise': dict(node='datapars', output='readnoise')})
        crossed = ValueGraph(dict(nodes=[pset, across], links=links), lambda id: None, str)
        self.assertEqual(crossed.parameters('imcombine')['fw'], dict(value=10.4))
        self.assertEqual(crossed.dependencies('imcombine'), set())
        # Workflow runs accept pset nodes and their typed rows.
        from giraf.request_schema import WorkflowValues
        checked = WorkflowValues.model_validate(dict(nodes=[pset, calc], links=links)).model_dump(exclude_unset=True)
        self.assertEqual(checked['nodes'][0]['rows'][0], dict(name='readnoise', value='5.2', type='r'))
        bad = dict(pset, rows=[dict(name='readnoise', value='x', type='r')], inputs={})
        self.assertIn('수치가 아닙니다', ValueGraph(dict(nodes=[bad], links=links[:1]), lambda id: None, str)
                      .parameters('imcombine')['rdnoise']['error'])

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


    def test_workflow_rejects_a_task_whose_values_read_its_own_run(self):
        # phot's whole datapars comes from the pset node; a row of it reads phot's own result.
        pset = dict(id='datapars', run='pset', rows=[dict(name='readnoise', value='5', type='r'),
                                                     dict(name='fwhmpsf', value='2.5', type='r')],
                    inputs={'fwhmpsf': dict(node='calc', output='m')})
        calc = dict(id='calc', run='value-compute', rows=[dict(name='m', value='mean(mag)')],
                    inputs={'mag': dict(node='phot', output='mag')})
        graph = dict(nodes=[dict(id='phot', label='phot', payload=dict(task='phot'))], links=[],
                     values=dict(nodes=[pset, calc], links=[
                         dict(id='l', target='phot', parameter='datapars.fwhmpsf', type='r', source=dict(node='calc', output='m'))]))
        with self.assertRaisesRegex(ValueError, '순환'):
            workflow_order(graph)
        # Reading only the unfed row is no loop.
        graph['values']['links'][0].update(parameter='datapars.readnoise', source=dict(node='datapars', output='readnoise'))
        self.assertEqual(workflow_order(graph), ['phot'])

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
