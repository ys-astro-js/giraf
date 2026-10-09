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



class LoopKeywordTests(unittest.TestCase):
    """A foreach by the header keywords chosen on it, and outside files matched to each pass."""

    science = {'b30a': {'SUBSET': 'B', 'EXPTIME': '30'}, 'v15a': {'SUBSET': 'V', 'EXPTIME': '15'},
               'b30b': {'SUBSET': 'B', 'EXPTIME': '30'}, 'v15b': {'SUBSET': 'V', 'EXPTIME': '15'}}

    def graph(self, keywords, extra_links=(), nodes=()):
        return {
            'nodes': [task('object'), task('ccdproc'), *[task(n) for n in nodes]],
            'flows': [{'id': 'loop', 'label': 'loop', 'run': 'foreach', 'variable': keywords[0] if keywords else '파일',
                       'keywords': list(keywords), 'members': ['ccdproc']}],
            'links': [link('object', 'loop', 'items', sourceRole='image'),
                      link('loop', 'ccdproc', 'images', sourceRole='item'), *extra_links],
        }

    def test_passes_are_value_combinations_sorted_naturally(self):
        from giraf.flows import Items, iterations
        items = files('b30a', 'v15a', 'b30b', 'v15b', 'b15', headers={**self.science, 'b15': {'SUBSET': 'B', 'EXPTIME': '15'}})
        flow = {'run': 'foreach', 'variable': 'SUBSET', 'keywords': ['SUBSET', 'EXPTIME']}
        passes = iterations(flow, items, Items(lambda id: id), {})
        self.assertEqual([p['partition'] for p in passes], [
            {'SUBSET': 'B', 'EXPTIME': '15'}, {'SUBSET': 'B', 'EXPTIME': '30'}, {'SUBSET': 'V', 'EXPTIME': '15'}])
        self.assertEqual([[i['id'] for i in p['ports']['item']] for p in passes], [['b15'], ['b30a', 'b30b'], ['v15a', 'v15b']])
        one = iterations(dict(flow, keywords=['EXPTIME']), items, Items(lambda id: id), {})
        self.assertEqual([p['partition'] for p in one], [{'EXPTIME': '15'}, {'EXPTIME': '30'}])
        # No keyword: once per file.
        self.assertEqual(len(iterations(dict(flow, keywords=[], variable='파일'), items, Items(lambda id: id), {})), 5)
        # An older document's partition is one keyword.
        old = iterations({'run': 'foreach', 'variable': 'image', 'partition': 'SUBSET'}, items, Items(lambda id: id), {})
        self.assertEqual([p['partition'] for p in old], [{'SUBSET': 'B'}, {'SUBSET': 'V'}])

    def test_the_loop_input_takes_several_links_and_each_file_once(self):
        runner = Runner({'front': files('d1', 'd2'), 'back': files('d2', 'd3')})
        graph = {'nodes': [task('front'), task('back'), task('combine')],
                 'flows': [{'id': 'loop', 'run': 'foreach', 'variable': '파일', 'members': ['combine']}],
                 'links': [link('front', 'loop', 'items'), link('back', 'loop', 'items'),
                           link('loop', 'combine', 'input', sourceRole='item')]}
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        self.assertEqual([p['inputs']['input'] for id, p in runner.calls if id == 'combine'], [['d1'], ['d2'], ['d3']])

    def test_outside_files_that_differ_in_a_keyword_go_to_their_pass(self):
        sources = {
            'object': files(*self.science, headers=self.science),
            'bias': files('Zero.fits', headers={'Zero.fits': {'IMAGETYP': 'zero'}}),
            'flats': files('FlatB.fits', 'FlatV.fits', headers={'FlatB.fits': {'SUBSET': 'B'}, 'FlatV.fits': {'SUBSET': 'V'}}),
            'darks': files('Dark15.fits', 'Dark30.fits', headers={'Dark15.fits': {'EXPTIME': '15'}, 'Dark30.fits': {'EXPTIME': '30'}}),
            # A reference taken in B, and a coordinate list without any header.
            'reference': files('pM67_B30_1.fits', headers={'pM67_B30_1.fits': {'SUBSET': 'B', 'EXPTIME': '30'}}),
            'coords': [{'id': 'm67.coo', 'asset': 'text', 'role': 'text'}],
        }
        single = dict(multiple=False)
        graph = self.graph(['SUBSET', 'EXPTIME'], [
            link('bias', 'ccdproc', 'zero', **single), link('flats', 'ccdproc', 'flat', **single),
            link('darks', 'ccdproc', 'dark', **single), link('reference', 'ccdproc', 'reference', **single),
            dict(link('coords', 'ccdproc', 'coords', **single), kind='text')], nodes=list(sources)[1:])
        runner = Runner(sources)
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        received = [p['inputs'] for id, p in runner.calls if id == 'ccdproc']
        self.assertEqual(received, [
            {'images': ['b30a', 'b30b'], 'zero': ['Zero.fits'], 'flat': ['FlatB.fits'], 'dark': ['Dark30.fits'],
             'reference': ['pM67_B30_1.fits'], 'coords': ['m67.coo']},
            {'images': ['v15a', 'v15b'], 'zero': ['Zero.fits'], 'flat': ['FlatV.fits'], 'dark': ['Dark15.fits'],
             'reference': ['pM67_B30_1.fits'], 'coords': ['m67.coo']}])
        self.assertNotIn('warnings', state)

    def runner_calls(self, graph, sources):
        runner = Runner(sources)
        run(graph, runner)
        return runner.calls

    def test_hand_picked_lists_inside_a_loop_deliver_that_pass_only(self):
        mixed = {'a15': {'EXPTIME': '15'}, 'a30': {'EXPTIME': '30'}, 'b15': {'EXPTIME': '15'}, 'b30': {'EXPTIME': '30'}}
        sources = {'object': files('s15', 's30', headers={'s15': {'EXPTIME': '15'}, 's30': {'EXPTIME': '30'}}),
                   'front': files('a15', 'a30', headers=mixed), 'back': files('b15', 'b30', headers=mixed)}
        graph = self.graph(['EXPTIME'], [link('front', 'ccdproc', 'dark'), link('back', 'ccdproc', 'dark')], nodes=['front', 'back'])
        darks = [p['inputs']['dark'] for id, p in self.runner_calls(graph, sources) if id == 'ccdproc']
        self.assertEqual(darks, [['a15', 'b15'], ['a30', 'b30']])

    def test_a_pass_without_a_matching_file_warns_and_runs_without_it(self):
        sources = {'object': files(*self.science, headers=self.science),
                   'darks': files('Dark30.fits', 'Dark60.fits', headers={'Dark30.fits': {'EXPTIME': '30'}, 'Dark60.fits': {'EXPTIME': '60'}})}
        graph = self.graph(['SUBSET', 'EXPTIME'], [link('darks', 'ccdproc', 'dark', multiple=False)], nodes=['darks'])
        runner = Runner(sources)
        state, reports = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        self.assertEqual([p['inputs'].get('dark') for id, p in runner.calls if id == 'ccdproc'], [['Dark30.fits'], None])
        self.assertEqual(state['warnings'], [{'nodeId': 'ccdproc', 'message': 'V 15 회차에 맞는 dark가 없습니다.'}])

    def test_outside_files_match_by_keywords_whose_values_the_passes_have(self):
        science = {'b30a': {'SUBSET': 'B', 'EXPTIME': '30.0'}, 'v15a': {'SUBSET': 'V', 'EXPTIME': '15.0'}}
        sources = {
            'object': files(*science, headers=science),
            # flatcombine changed EXPTIME, which no pass has: the flats match by SUBSET alone.
            'flats': files('FlatB.fits', 'FlatV.fits', headers={'FlatB.fits': {'SUBSET': 'B', 'EXPTIME': 30.66011},
                                                                'FlatV.fits': {'SUBSET': 'V', 'EXPTIME': 30.75525}}),
            'darks': files('Dark15.fits', 'Dark30.fits', headers={'Dark15.fits': {'EXPTIME': 15.0}, 'Dark30.fits': {'EXPTIME': 30.0}}),
            # 15 is 15.0.
            'ints': files('D15.fits', 'D30.fits', headers={'D15.fits': {'EXPTIME': '15'}, 'D30.fits': {'EXPTIME': '30'}}),
            'bias': files('Zero.fits', headers={'Zero.fits': {'IMAGETYP': 'zero'}}),
            'reference': files('Ref.fits', headers={'Ref.fits': {'SUBSET': 'B', 'EXPTIME': '30'}}),
            'coords': [{'id': 'm67.coo', 'asset': 'text', 'role': 'text'}],
        }
        single = dict(multiple=False)
        graph = self.graph(['SUBSET', 'EXPTIME'], [
            link('flats', 'ccdproc', 'flat', **single), link('darks', 'ccdproc', 'dark', **single),
            link('ints', 'ccdproc', 'dark2', **single), link('bias', 'ccdproc', 'zero', **single),
            link('reference', 'ccdproc', 'reference', **single),
            dict(link('coords', 'ccdproc', 'coords', **single), kind='text')], nodes=list(sources)[1:])
        runner = Runner(sources)
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        received = [p['inputs'] for id, p in runner.calls if id == 'ccdproc']
        self.assertEqual(received, [
            {'images': ['b30a'], 'flat': ['FlatB.fits'], 'dark': ['Dark30.fits'], 'dark2': ['D30.fits'],
             'zero': ['Zero.fits'], 'reference': ['Ref.fits'], 'coords': ['m67.coo']},
            {'images': ['v15a'], 'flat': ['FlatV.fits'], 'dark': ['Dark15.fits'], 'dark2': ['D15.fits'],
             'zero': ['Zero.fits'], 'reference': ['Ref.fits'], 'coords': ['m67.coo']}])
        self.assertNotIn('warnings', state)

    def test_whole_number_pass_values_read_without_decimals(self):
        from giraf.flows import Items, iterations, loop_values, pass_name
        from giraf.values import pass_value
        self.assertEqual([pass_value(v) for v in ('15.0', ' 30.00 ', '15', '30.66011', 'B', '', '1e2')],
                         ['15', '30', '15', '30.66011', 'B', '', '100'])
        self.assertEqual(pass_name({'SUBSET': 'B', 'EXPTIME': '30.0'}), 'B 30')
        self.assertEqual(pass_name({'SUBSET': '', 'EXPTIME': '30.66011'}), '없음 30.66011')
        science = {'b30': {'SUBSET': 'B', 'EXPTIME': 30.0}, 'v15': {'SUBSET': 'V', 'EXPTIME': 15.0}}
        flow = {'run': 'foreach', 'variable': 'SUBSET', 'keywords': ['SUBSET', 'EXPTIME']}
        passes = iterations(flow, files(*science, headers=science), Items(lambda id: id), {})
        # The pass keeps the header's text for grouping and matching.
        self.assertEqual([p['partition'] for p in passes], [{'SUBSET': 'B', 'EXPTIME': '30.0'}, {'SUBSET': 'V', 'EXPTIME': '15.0'}])
        self.assertEqual(loop_values(flow, passes[1], None), {'SUBSET': 'V', 'EXPTIME': '15'})
        sources = {'object': files(*science, headers=science),
                   'darks': files('Dark30.fits', 'Dark60.fits', headers={'Dark30.fits': {'EXPTIME': 30.0}, 'Dark60.fits': {'EXPTIME': 60.0}})}
        graph = self.graph(['SUBSET', 'EXPTIME'], [link('darks', 'ccdproc', 'dark', multiple=False)], nodes=['darks'])
        graph['nodes'][1]['payload']['outputs'] = {'output': 'Dark{EXPTIME}.fits'}
        runner = Runner(sources)
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        self.assertEqual([p['outputs']['output'] for id, p in runner.calls if id == 'ccdproc'], ['Dark30.fits', 'Dark15.fits'])
        self.assertEqual([p['inputs'].get('dark') for id, p in runner.calls if id == 'ccdproc'], [['Dark30.fits'], None])
        self.assertEqual(state['warnings'], [{'nodeId': 'ccdproc', 'message': 'V 15 회차에 맞는 dark가 없습니다.'}])

    def test_darks_some_passes_lack_leave_those_passes_empty(self):
        science = {'s15': {'EXPTIME': '15'}, 's30': {'EXPTIME': '30'}}
        sources = {'object': files(*science, headers=science),
                   'darks': files('Dark15.fits', 'Dark60.fits', headers={'Dark15.fits': {'EXPTIME': '15'}, 'Dark60.fits': {'EXPTIME': '60'}})}
        graph = self.graph(['EXPTIME'], [link('darks', 'ccdproc', 'dark', multiple=False)], nodes=['darks'])
        runner = Runner(sources)
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        self.assertEqual([p['inputs'].get('dark') for id, p in runner.calls if id == 'ccdproc'], [['Dark15.fits'], None])
        self.assertEqual(state['warnings'], [{'nodeId': 'ccdproc', 'message': '30 회차에 맞는 dark가 없습니다.'}])

    def test_files_the_editor_resolved_are_matched_too(self):
        import tempfile
        from pathlib import Path
        import numpy as np
        from astropy.io import fits
        sources = {'object': files(*self.science, headers=self.science)}
        graph = self.graph(['SUBSET'])
        graph['flows'][0]['fileInputs'] = [{'target': 'ccdproc', 'role': 'flat', 'kind': 'image', 'multiple': False,
                                            'files': ['FlatB.fits', 'FlatV.fits']}]
        WorkflowRequest.model_validate(graph)
        runner = Runner(sources)
        with tempfile.TemporaryDirectory() as tmp:
            for name, subset in (('FlatB.fits', 'B'), ('FlatV.fits', 'V')):
                fits.writeto(Path(tmp) / name, np.zeros((2, 2), dtype='float32'), fits.Header({'SUBSET': subset}))
            state = execute_workflow(graph, runner, lambda: False, lambda s: None, lambda id: str(Path(tmp) / id))
        self.assertEqual(state['state'], 'completed', state['message'])
        self.assertEqual([p['inputs']['flat'] for id, p in runner.calls if id == 'ccdproc'], [['FlatB.fits'], ['FlatV.fits']])

    def test_output_names_read_each_keyword_and_old_variables(self):
        sources = {'object': files(*self.science, headers=self.science)}
        graph = self.graph(['SUBSET', 'EXPTIME'])
        graph['nodes'][1]['payload']['outputs'] = {'output': 'p{SUBSET}_{EXPTIME}.fits'}
        names = [p['outputs']['output'] for id, p in self.runner_calls(graph, sources) if id == 'ccdproc']
        self.assertEqual(names, ['pB_30.fits', 'pV_15.fits'])
        from giraf.flows import constant_outputs, loop_values
        self.assertEqual(loop_values({'run': 'foreach', 'variable': 'image'}, {'partition': {'FILTER': 'B'}, 'ports': {}}, None),
                         {'FILTER': 'B', 'image': 'B'})
        spec = {'adapter': 'generic', 'outputs': [{'name': 'output', 'mode': 'single', 'default': 'x.fits'}]}
        self.assertEqual(constant_outputs(spec, {'outputs': {'output': 'Dark{EXPTIME}.fits'}}, ['SUBSET', 'EXPTIME']), [])
        self.assertEqual(len(constant_outputs(spec, {'outputs': {'output': 'Dark.fits'}}, ['SUBSET', 'EXPTIME'])), 1)

    def test_a_second_loop_by_the_same_keywords_takes_its_own_pass_results(self):
        sources = {'object': files(*self.science, headers=self.science)}
        keywords = ['SUBSET', 'EXPTIME']
        graph = {
            'nodes': [task('object'), task('ccdproc'), task('combine')],
            'flows': [{'id': 'first', 'run': 'foreach', 'variable': 'SUBSET', 'keywords': keywords, 'members': ['ccdproc']},
                      {'id': 'second', 'run': 'foreach', 'variable': 'SUBSET', 'keywords': keywords, 'members': ['combine']}],
            'links': [link('object', 'first', 'items', sourceRole='image'), link('first', 'ccdproc', 'images', sourceRole='item'),
                      link('ccdproc', 'first', 'result', sourceRole='output'),
                      link('object', 'second', 'items', sourceRole='image'), link('second', 'combine', 'images', sourceRole='item'),
                      # Results without headers pair by the pass values they carry.
                      link('first', 'combine', 'processed', sourceRole='results')],
        }
        calls = self.runner_calls(graph, sources)
        self.assertEqual([p['inputs']['processed'] for id, p in calls if id == 'combine'],
                         [['ccdproc(b30a)', 'ccdproc(b30b)'], ['ccdproc(v15a)', 'ccdproc(v15b)']])

    def test_pass_values_pick_the_group_of_a_value_by_one_keyword(self):
        from giraf.values import parameter_value
        result = {'values': [3.38, 3.07], 'groups': {'keyword': 'SUBSET', 'values': {'B': [3.38], 'V': [3.07]}}}
        self.assertEqual(parameter_value(result, {'SUBSET': 'V', 'EXPTIME': '15'}, 'r'), 3.07)
        self.assertEqual(parameter_value(result, {'keyword': 'SUBSET', 'value': 'B'}, 'r'), 3.38)
        from giraf.workflow import same_group
        self.assertTrue(same_group({'partition': {'keyword': 'SUBSET', 'value': 'B'}}, {'SUBSET': 'B', 'EXPTIME': '30'}))
        self.assertFalse(same_group({'partition': {'SUBSET': 'B', 'EXPTIME': '15'}}, {'SUBSET': 'B', 'EXPTIME': '30'}))
        self.assertTrue(same_group({'partition': {'SUBSET': 'B', 'EXPTIME': '15'}}, {'SUBSET': 'B'}))

    def test_the_korean_particle_follows_the_word(self):
        from giraf.flows import with_subject
        self.assertEqual([with_subject(w) for w in ('dark', 'flat', 'zero', '영상', '파일', 'm67.coo', 'Bias 1')],
                         ['dark가', 'flat가', 'zero가', '영상이', '파일이', 'm67.coo가', 'Bias 1이'])


if __name__ == '__main__':
    unittest.main()
