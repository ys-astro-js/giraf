import unittest
from copy import deepcopy

from giraf.request_schema import WorkflowRequest
from giraf.flows import flow_errors, flow_range
from giraf.workflow import execute_workflow, workflow_order
from giraf.workflow_diagnostics import diagnose_flows


def task(id, task='fake'):
    return {'id': id, 'label': id, 'payload': {'task': task, 'inputs': {}, 'parameters': {}}}


def link(source, target, role='input', **extra):
    return {'source': source, 'target': target, 'role': role, 'kind': 'image', 'multiple': True, **extra}


def files(*names, headers=None):
    return [{'id': name, 'asset': 'image', 'role': 'image', 'headers': (headers or {}).get(name, {})} for name in names]


class Runner:
    """Each member run makes one product per input file, named after the run."""

    def __init__(self, sources):
        self.sources, self.calls = sources, []

    def __call__(self, node, payload):
        self.calls.append((node['id'], deepcopy(payload)))
        id = f"{node['id']}-{len(self.calls)}"
        if node['id'] in self.sources:
            return {'id': id, 'state': 'completed', 'products': self.sources[node['id']]}
        inputs = [file for ids in payload['inputs'].values() for file in ids] or ['none']
        return {'id': id, 'state': 'completed',
                'products': [{'id': f'{node["id"]}({file})', 'asset': 'image', 'role': 'output'} for file in inputs]}


def run(graph, runner):
    reports = []
    state = execute_workflow(graph, runner, lambda: False, reports.append)
    return state, reports


class FlowTests(unittest.TestCase):
    def foreach_graph(self, partition=None):
        return {
            'nodes': [task('object'), task('ccdproc'), task('combine')],
            'flows': [{'id': 'loop', 'label': 'foreach', 'run': 'foreach', 'variable': 'image',
                       'members': ['ccdproc'], **({'partition': partition} if partition else {})}],
            'links': [link('object', 'loop', 'items', sourceRole='image'),
                      link('loop', 'ccdproc', 'images', sourceRole='item'),
                      link('ccdproc', 'loop', 'result', sourceRole='output'),
                      link('loop', 'combine', 'input', sourceRole='results')],
        }

    def test_foreach_runs_members_once_per_file_and_collects_results(self):
        runner = Runner({'object': files('a.fits', 'b.fits', 'c.fits')})
        graph = self.foreach_graph()
        self.assertEqual(workflow_order(graph), ['object', 'loop', 'combine'])
        state, reports = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        member = [payload['inputs']['images'] for id, payload in runner.calls if id == 'ccdproc']
        self.assertEqual(member, [['a.fits'], ['b.fits'], ['c.fits']])
        # The boundary output is every iteration's result, in order.
        combine = next(payload for id, payload in runner.calls if id == 'combine')
        self.assertEqual(combine['inputs']['input'], ['ccdproc(a.fits)', 'ccdproc(b.fits)', 'ccdproc(c.fits)'])
        progress = [r['flow'] for r in reports if r.get('flow')]
        self.assertIn(dict(id='loop', index=2, total=3), progress)
        self.assertNotIn('flow', state)
        self.assertEqual([job['instanceId'] for job in state['jobs']].count('ccdproc'), 3)

    def test_foreach_over_partition_groups_and_their_values(self):
        headers = {'b1': {'FILTER': 'B'}, 'v1': {'FILTER': 'V'}, 'b2': {'FILTER': 'B'}}
        runner = Runner({'object': files('b1', 'v1', 'b2', headers=headers)})
        graph = self.foreach_graph('FILTER')
        graph['values'] = {
            'nodes': [{'id': 'fwhm', 'run': 'value-constant', 'partition': 'FILTER',
                       'rows': [{'name': 'fwhm', 'value': '', 'groups': {'B': '3.38', 'V': '3.07'}}]}],
            'links': [{'id': 'l', 'target': 'ccdproc', 'parameter': 'fwhmpsf', 'type': 'r',
                       'source': {'node': 'fwhm', 'output': 'fwhm'}}],
        }
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        member = [(p['inputs']['images'], p['parameters']['fwhmpsf']) for id, p in runner.calls if id == 'ccdproc']
        # B and V run once each; members get that group's files and value.
        self.assertEqual(member, [(['b1', 'b2'], 3.38), (['v1'], 3.07)])

    def test_a_second_foreach_pairs_the_first_ones_results_by_group(self):
        headers = {'b1': {'FILTER': 'B'}, 'v1': {'FILTER': 'V'}}
        runner = Runner({'object': files('b1', 'v1', headers=headers)})
        graph = {
            'nodes': [task('object'), task('phot'), task('psf')],
            'flows': [{'id': 'aperture', 'label': 'aperture', 'run': 'foreach', 'variable': 'image',
                       'members': ['phot'], 'partition': 'FILTER'},
                      {'id': 'fit', 'label': 'fit', 'run': 'foreach', 'variable': 'image',
                       'members': ['psf'], 'partition': 'FILTER'}],
            'links': [link('object', 'aperture', 'items', sourceRole='image'),
                      link('object', 'fit', 'items', sourceRole='image'),
                      link('aperture', 'phot', 'image', sourceRole='item'),
                      link('fit', 'psf', 'image', sourceRole='item'),
                      link('phot', 'psf', 'photfile', sourceRole='output', multiple=False)],
        }
        self.assertEqual(workflow_order(graph), ['object', 'aperture', 'fit'])
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        fit = [(p['inputs']['image'], p['inputs']['photfile']) for id, p in runner.calls if id == 'psf']
        self.assertEqual(fit, [(['b1'], ['phot(b1)']), (['v1'], ['phot(v1)'])])

    def test_for_feeds_its_variable_into_member_parameters(self):
        self.assertEqual(flow_range({'start': 2, 'end': 10, 'step': 2}), [2, 4, 6, 8, 10])
        self.assertEqual(flow_range({'start': 1.0, 'end': 0.5, 'step': -0.25}), [1.0, 0.75, 0.5])
        runner = Runner({'image': files('m67.fits')})
        graph = {
            'nodes': [task('image'), task('phot')],
            'flows': [{'id': 'range', 'run': 'for', 'variable': 'r', 'start': 2, 'end': 6, 'step': 2, 'members': ['phot']}],
            'links': [link('image', 'phot', 'image'), link('phot', 'range', 'result', sourceRole='output')],
            'values': {'nodes': [{'id': 'range', 'run': 'value-constant', 'rows': [{'name': 'r', 'value': '2'}]}],
                       'links': [{'id': 'v', 'target': 'phot', 'parameter': 'photpars.aperture', 'type': 'r',
                                  'source': {'node': 'range', 'output': 'r'}}]},
        }
        self.assertEqual(workflow_order(graph), ['image', 'range'])
        checked = WorkflowRequest.model_validate(graph).model_dump(exclude_unset=True)
        self.assertEqual(checked['flows'][0]['start'], 2)
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        apertures = [p['parameterSets']['photpars']['aperture'] for id, p in runner.calls if id == 'phot']
        self.assertEqual(apertures, [2.0, 4.0, 6.0])
        # Each iteration still takes the files from outside the container.
        self.assertTrue(all(p['inputs']['image'] == ['m67.fits'] for id, p in runner.calls if id == 'phot'))

    def if_graph(self, condition):
        return {
            'nodes': [task('object'), task('long'), task('short'), task('after')],
            'flows': [{'id': 'branch', 'run': 'if', 'condition': condition, 'members': ['long', 'short']}],
            'links': [link('object', 'branch', 'input', sourceRole='image'),
                      link('branch', 'long', 'images', sourceRole='then'),
                      link('branch', 'short', 'images', sourceRole='else'),
                      link('long', 'branch', 'result', sourceRole='output'),
                      link('short', 'branch', 'result', sourceRole='output'),
                      link('branch', 'after', 'input', sourceRole='results')],
        }

    def test_if_routes_each_file_by_a_header_expression_and_merges_lanes(self):
        headers = {'a': {'EXPTIME': '60'}, 'b': {'EXPTIME': '10'}, 'c': {'EXPTIME': '120'}}
        runner = Runner({'object': files('a', 'b', 'c', headers=headers)})
        state, _ = run(self.if_graph('EXPTIME > 30'), runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        calls = {id: p['inputs'] for id, p in runner.calls}
        self.assertEqual(calls['long']['images'], ['a', 'c'])
        self.assertEqual(calls['short']['images'], ['b'])
        self.assertEqual(calls['after']['input'], ['long(a)', 'long(c)', 'short(b)'])

    def test_if_with_a_value_sends_everything_to_one_lane(self):
        runner = Runner({'object': files('a', 'b')})
        graph = self.if_graph('fwhm > 4.0')
        graph['values'] = {'nodes': [{'id': 'm', 'run': 'value-constant', 'rows': [{'name': 'fwhm', 'value': '3.2'}]}],
                           'links': [{'id': 'c', 'target': 'branch', 'parameter': 'fwhm', 'type': 'any',
                                      'source': {'node': 'm', 'output': 'fwhm'}}]}
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        ran = [id for id, _ in runner.calls]
        self.assertNotIn('long', ran)
        self.assertEqual(dict((id, p['inputs']) for id, p in runner.calls)['after']['input'], ['short(a)', 'short(b)'])

    def test_invalid_settings_fail_the_run_and_are_diagnosed(self):
        self.assertEqual(flow_errors({'run': 'for', 'variable': 'r', 'start': 1, 'end': 5, 'step': 0}), ['간격은 0이 될 수 없습니다.'])
        self.assertTrue(flow_errors({'run': 'for', 'variable': '1r', 'start': 1, 'end': 5}))
        self.assertTrue(flow_errors({'run': 'if', 'condition': 'EXPTIME >'}))
        self.assertFalse(flow_errors({'run': 'if', 'condition': 'IMAGETYP == "object" && EXPTIME > 30'}))
        issues = []
        diagnose_flows([{'id': 'f', 'run': 'foreach', 'variable': 'image', 'members': []}], [],
                       lambda severity, message, node, connection=None: issues.append((severity, node)))
        self.assertEqual(issues, [('error', 'f'), ('warning', 'f')])
        graph = self.if_graph('')
        state, _ = run(graph, Runner({'object': files('a')}))
        self.assertEqual(state['state'], 'failed')
        self.assertIn('조건 식', state['message'])

    def test_output_names_read_the_loop_variable_per_iteration(self):
        def names(graph, runner, member):
            state, _ = run(graph, runner)
            self.assertEqual(state['state'], 'completed', state['message'])
            return [(p['outputs'], p.get('output')) for id, p in runner.calls if id == member]

        # foreach over a partitioned bundle: the partition value.
        headers = {'b1': {'FILTER': 'B'}, 'v1': {'FILTER': 'V'}}
        graph = self.foreach_graph('FILTER')
        graph['nodes'][1]['payload'].update(outputs={'$stdout': 'M67{image}.dat', 'log': '{name}{image}{other}'},
                                            output={'name': 'x{image}'})
        self.assertEqual(names(graph, Runner({'object': files('b1', 'v1', headers=headers)}), 'ccdproc'), [
            ({'$stdout': 'M67B.dat', 'log': '{name}B{other}'}, {'name': 'xB'}),
            ({'$stdout': 'M67V.dat', 'log': '{name}V{other}'}, {'name': 'xV'})])
        # foreach over files: the file's stem.
        graph = self.foreach_graph()
        graph['nodes'][1]['payload']['outputs'] = {'$stdout': '{image}.dat'}
        result = names(graph, Runner({'object': [dict(f, label=f['id']) for f in files('a.fits', 'b.fit')]}), 'ccdproc')
        self.assertEqual([o['$stdout'] for o, _ in result], ['a.dat', 'b.dat'])
        # for: the number as the range writes it; the node's own payload is unchanged.
        graph = {'nodes': [task('phot')], 'links': [],
                 'flows': [{'id': 'range', 'run': 'for', 'variable': 'r', 'start': 2, 'end': 4, 'step': 2, 'members': ['phot']}]}
        graph['nodes'][0]['payload']['outputs'] = {'$stdout': 'ap{r}.txt'}
        result = names(graph, Runner({}), 'phot')
        self.assertEqual([o['$stdout'] for o, _ in result], ['ap2.txt', 'ap4.txt'])
        self.assertEqual(graph['nodes'][0]['payload']['outputs'], {'$stdout': 'ap{r}.txt'})
        self.assertTrue(flow_errors({'run': 'foreach', 'variable': 'name'}))

    def test_loop_outputs_named_the_same_every_iteration_are_diagnosed(self):
        from giraf.workflow_diagnostics import diagnose_loop_outputs
        member = lambda name: {'id': 'dump', 'payload': {'task': 'noao.digiphot.ptools.txdump', 'parameters': {},
                                                          'outputs': {'$stdout': name}}}
        for name, expected in (('M67.dat', 1), ('M67{image}.dat', 0)):
            issues = []
            diagnose_loop_outputs([{'id': 'f', 'run': 'foreach', 'variable': 'image', 'members': ['dump']}],
                                  {'dump': member(name)}, lambda *a, **k: issues.append(a))
            self.assertEqual(len(issues), expected, name)
            if expected:
                self.assertEqual((issues[0][0], issues[0][2]), ('warning', 'dump'))
                self.assertIn('{image}', issues[0][1])

    def test_bundled_container_nodes_are_flow_components(self):
        from giraf.node_schema import BUNDLED, load_layers, node_definition
        layers, _ = load_layers([('giraf', BUNDLED)])
        for name, run, inputs in (('giraf.foreach', 'foreach', ['items']), ('giraf.for', 'for', []), ('giraf.if', 'if', ['input'])):
            node = node_definition(name, layers[name])
            self.assertTrue(node['runnable'], node['reason'])
            self.assertEqual((node['run'], [i['name'] for i in node['inputs']], node['outputs']), (run, inputs, []))
        bad = dict(layers['giraf.for'][0], patch={**layers['giraf.for'][0]['patch'], 'inputs': {'x': {'kind': 'any'}}})
        self.assertFalse(node_definition('giraf.for', [bad])['runnable'])


if __name__ == '__main__':
    unittest.main()
