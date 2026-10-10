import unittest
from copy import deepcopy

from giraf.request_schema import WorkflowRequest
from giraf.flows import Items, flow_errors, rounds
from giraf.workflow import execute_workflow, workflow_order
from giraf.workflow_diagnostics import diagnose_flows, diagnose_loop_outputs


def task(id, task='fake'):
    return {'id': id, 'label': id, 'payload': {'task': task, 'inputs': {}, 'parameters': {}}}


def link(source, target, role='input', **extra):
    return {'source': source, 'target': target, 'role': role, 'kind': 'image', 'multiple': True, **extra}


def files(*names, headers=None):
    return [{'id': name, 'label': name, 'asset': 'image', 'role': 'image', 'headers': (headers or {}).get(name, {})}
            for name in names]


def region(id, criteria, split=None, members=(), **extra):
    return {'id': id, 'label': id, 'criteria': criteria, 'members': list(members),
            **({'split': {'taskId': split}} if split else {}), **extra}


class Runner:
    """Each run makes one product per input file, named after the run; a
    `combine` task makes one product from all of them."""

    def __init__(self, sources, combine=()):
        self.sources, self.combine, self.calls = sources, set(combine), []

    def __call__(self, node, payload):
        self.calls.append((node['id'], deepcopy(payload)))
        id = f"{node['id']}-{len(self.calls)}"
        if node['id'] in self.sources:
            return {'id': id, 'state': 'completed', 'products': self.sources[node['id']]}
        inputs = [file for ids in payload['inputs'].values() for file in ids] or ['none']
        if node['id'] in self.combine:
            first = payload['inputs'].get('input', inputs)[0]
            return {'id': id, 'state': 'completed', 'products': [{'id': f'{node["id"]}[{first}]', 'asset': 'image', 'role': 'output'}]}
        return {'id': id, 'state': 'completed',
                'products': [{'id': f'{node["id"]}({file})', 'asset': 'image', 'role': 'output'} for file in inputs]}

    def inputs(self, id, role='input'):
        return [payload['inputs'].get(role) for node, payload in self.calls if node == id]


def run(graph, runner):
    reports = []
    WorkflowRequest.model_validate(graph)
    state = execute_workflow(graph, runner, lambda: False, reports.append)
    return state, reports


EXPTIME = lambda value: {'EXPTIME': value}
DARKS = {**{f'd15_{n}': EXPTIME('15') for n in range(1, 8)}, **{f'd30_{n}': EXPTIME('30.0') for n in range(1, 4)}}
SCIENCE = {'b30a': {'FILTER': 'B', 'EXPTIME': '30'}, 'v15a': {'FILTER': 'V', 'EXPTIME': '15'},
           'b30b': {'FILTER': 'B', 'EXPTIME': '30'}, 'v15b': {'FILTER': 'V', 'EXPTIME': '15.0'},
           'v30a': {'FILTER': 'V', 'EXPTIME': '30'}}
FLATS = {'fb1': {'FILTER': 'B'}, 'fb2': {'FILTER': 'B'}, 'fv1': {'FILTER': 'V'}}


class ScenarioTests(unittest.TestCase):
    """The five uses of docs/node-structure-brief.md §3.5, at the planning level."""

    def test_bias_median_in_chunks_of_five_then_average(self):
        bias = [f'b{n:02}' for n in range(1, 13)]
        graph = {
            'nodes': [task('bias'), task('median'), task('average')],
            'flows': [region('chunks', [{'count': 5, 'order': 'name'}], 'bias', ['median'])],
            'links': [link('bias', 'median'), link('median', 'average')],
        }
        graph['nodes'][1]['payload']['outputs'] = {'output': 'Zero_{묶음}.fits'}
        self.assertEqual(workflow_order(graph), ['bias', 'chunks', 'average'])
        runner = Runner({'bias': files(*reversed(bias))}, combine=['median', 'average'])
        state, reports = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        # Sorted by name, five at a time; the rest is the last round.
        self.assertEqual(runner.inputs('median'), [bias[:5], bias[5:10], bias[10:]])
        self.assertEqual([p['outputs']['output'] for id, p in runner.calls if id == 'median'],
                         ['Zero_1.fits', 'Zero_2.fits', 'Zero_3.fits'])
        # Leaving the region gathers every round's result.
        self.assertEqual(runner.inputs('average'), [['median[b01]', 'median[b06]', 'median[b11]']])
        self.assertIn(dict(id='chunks', index=2, total=3), [r.get('flow') for r in reports])
        self.assertNotIn('flow', state)

    def dark_graph(self):
        return {
            'nodes': [task('darks'), task('mbias'), task('median'), task('average')],
            'flows': [region('exp', [{'keyword': 'EXPTIME'}], 'darks', ['chunk', 'average']),
                      region('chunk', [{'count': 5}], 'darks', ['median'])],
            'links': [link('darks', 'median'), link('mbias', 'median', 'zero', multiple=False),
                      link('median', 'average')],
        }

    def test_dark_by_exptime_with_chunks_of_five_inside(self):
        graph = self.dark_graph()
        graph['nodes'][2]['payload']['outputs'] = {'output': 'Dark{EXPTIME}_{묶음}.fits'}
        self.assertEqual(workflow_order(graph), ['darks', 'mbias', 'exp'])
        runner = Runner({'darks': files(*DARKS, headers=DARKS), 'mbias': files('Zero.fits')}, combine=['median', 'average'])
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        d15 = [f'd15_{n}' for n in range(1, 8)]
        self.assertEqual(runner.inputs('median'), [d15[:5], d15[5:], ['d30_1', 'd30_2', 'd30_3']])
        # The bias reaches every round; nested rounds name outputs by both labels.
        self.assertEqual(runner.inputs('median', 'zero'), [['Zero.fits']] * 3)
        self.assertEqual([p['outputs']['output'] for id, p in runner.calls if id == 'median'],
                         ['Dark15_1.fits', 'Dark15_2.fits', 'Dark30_1.fits'])
        # The outer round gathers its own chunks only.
        self.assertEqual(runner.inputs('average'), [['median[d15_1]', 'median[d15_6]'], ['median[d30_1]']])
        self.assertNotIn('warnings', state)

    def test_flat_per_filter(self):
        graph = {
            'nodes': [task('flats'), task('mbias'), task('flatcombine')],
            'flows': [region('flat', [{'keyword': 'FILTER'}], 'flats', ['flatcombine'])],
            'links': [link('flats', 'flatcombine'), link('mbias', 'flatcombine', 'zero', multiple=False)],
        }
        runner = Runner({'flats': files(*FLATS, headers=FLATS), 'mbias': files('Zero.fits')}, combine=['flatcombine'])
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        self.assertEqual(runner.inputs('flatcombine'), [['fb1', 'fb2'], ['fv1']])
        self.assertEqual(runner.inputs('flatcombine', 'zero'), [['Zero.fits'], ['Zero.fits']])

    def ccdproc_graph(self, flat_mode=True):
        graph = self.dark_graph()
        graph['nodes'] += [task('science'), task('mflat'), task('ccdproc')]
        graph['flows'].append(region('proc', [{'keyword': 'FILTER'}, {'keyword': 'EXPTIME'}], 'science', ['ccdproc']))
        flat = {'flow': {'proc': {'mode': 'match', 'keys': ['FILTER']}}} if flat_mode else {}
        graph['links'] += [link('science', 'ccdproc', 'images'), link('mbias', 'ccdproc', 'zero', multiple=False),
                           link('average', 'ccdproc', 'dark', multiple=False),
                           link('mflat', 'ccdproc', 'flat', multiple=False, **flat)]
        return graph

    def ccdproc_sources(self):
        flats = {'FlatB.fits': {'FILTER': 'B', 'EXPTIME': '30.66'}, 'FlatV.fits': {'FILTER': 'V', 'EXPTIME': '30.75'}}
        return {'darks': files(*DARKS, headers=DARKS), 'mbias': files('Zero.fits'),
                'science': files(*SCIENCE, headers=SCIENCE), 'mflat': files(*flats, headers=flats)}

    def test_ccdproc_by_filter_and_exptime_pairs_calibrations(self):
        graph = self.ccdproc_graph()
        runner = Runner(self.ccdproc_sources(), combine=['median', 'average'])
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        received = [{k: v for k, v in p['inputs'].items()} for id, p in runner.calls if id == 'ccdproc']
        self.assertEqual(received, [
            # B 30, V 15, V 30: the bias in every round, the master dark by its EXPTIME
            # label, the master flat by its FILTER header (a file node, no labels).
            {'images': ['b30a', 'b30b'], 'zero': ['Zero.fits'], 'dark': ['average[median[d30_1]]'], 'flat': ['FlatB.fits']},
            {'images': ['v15a', 'v15b'], 'zero': ['Zero.fits'], 'dark': ['average[median[d15_1]]'], 'flat': ['FlatV.fits']},
            {'images': ['v30a'], 'zero': ['Zero.fits'], 'dark': ['average[median[d30_1]]'], 'flat': ['FlatV.fits']}])
        self.assertNotIn('warnings', state)

    def test_master_darks_of_every_round_reach_a_later_run(self):
        """The darks group ran first: its Master Dark ran once per EXPTIME round.
        Run alone, the ccdproc group receives every round's master dark and
        each of its rounds takes the one of its EXPTIME."""
        darks = self.dark_graph()
        runner = Runner(self.ccdproc_sources(), combine=['median', 'average'])
        state, _ = run(darks, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        made = [p for job in state['jobs'] if job['instanceId'] == 'average' for p in job['products']]
        self.assertEqual([(p['id'], p['labels']) for p in made],
                         [('average[median[d15_1]]', {'EXPTIME': '15'}), ('average[median[d30_1]]', {'EXPTIME': '30.0'})])
        labels = {p['id']: p['labels'] for p in made}
        graph = self.ccdproc_graph()
        graph['nodes'] = [n for n in graph['nodes'] if n['id'] in ('science', 'mflat', 'mbias', 'ccdproc')]
        graph['flows'] = [f for f in graph['flows'] if f['id'] == 'proc']
        graph['links'] = [l for l in graph['links'] if l['target'] == 'ccdproc' and l['role'] != 'dark'] + [
            link('average', 'ccdproc', 'dark', multiple=False, files=list(labels),
                 flow={'proc': {'mode': 'match', 'keys': ['EXPTIME']}})]
        WorkflowRequest.model_validate(graph)
        runner = Runner(self.ccdproc_sources())
        state = execute_workflow(graph, runner, lambda: False, lambda s: None, None, labels.get)
        self.assertEqual(state['state'], 'completed', state['message'])
        self.assertEqual(runner.inputs('ccdproc', 'dark'),
                         [['average[median[d30_1]]'], ['average[median[d15_1]]'], ['average[median[d30_1]]']])
        self.assertNotIn('warnings', state)

    def test_a_round_job_records_its_values(self):
        seen = []
        runner = Runner(self.ccdproc_sources(), combine=['median', 'average'])
        def recording(node, payload):
            seen.append((node['id'], (node.get('round') or {}).get('values')))
            return runner(node, payload)
        state, _ = run(self.dark_graph(), recording)
        self.assertEqual(state['state'], 'completed', state['message'])
        self.assertEqual([values for id, values in seen if id == 'average'], [{'EXPTIME': '15'}, {'EXPTIME': '30.0'}])

    def test_without_a_stored_mode_unlabelled_files_reach_every_round(self):
        graph = self.ccdproc_graph(flat_mode=False)
        graph['links'] = [l for l in graph['links'] if l['role'] != 'flat'] + [link('mflat', 'ccdproc', 'flat')]
        runner = Runner(self.ccdproc_sources(), combine=['median', 'average'])
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        self.assertEqual(runner.inputs('ccdproc', 'flat'), [['FlatB.fits', 'FlatV.fits']] * 3)

    def test_gathered_results_split_again_by_their_labels(self):
        graph = {
            'nodes': [task('science'), task('phot'), task('collect'), task('psf')],
            'flows': [region('aperture', [{'keyword': 'FILTER'}], 'science', ['phot']),
                      region('fit', [{'keyword': 'FILTER'}], 'phot', ['psf'])],
            'links': [link('science', 'phot', 'image'), link('phot', 'collect'), link('phot', 'psf', 'photfile')],
        }
        self.assertEqual(workflow_order(graph), ['science', 'aperture', 'collect', 'fit'])
        runner = Runner({'science': files(*SCIENCE, headers=SCIENCE)})
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        # The products of phot carry no headers: the second region reads their labels.
        self.assertEqual(runner.inputs('collect'), [['phot(b30a)', 'phot(b30b)', 'phot(v15a)', 'phot(v15b)', 'phot(v30a)']])
        self.assertEqual(runner.inputs('psf', 'photfile'), [['phot(b30a)', 'phot(b30b)'], ['phot(v15a)', 'phot(v15b)', 'phot(v30a)']])


class RoundTests(unittest.TestCase):
    items = files(*SCIENCE, headers=SCIENCE)

    def names(self, criteria, **extra):
        flow = dict(criteria=criteria, split={'taskId': 'x'}, **extra)
        return [(step['values'], [i['id'] for i in step['items']]) for step in rounds(flow, self.items, Items(str))]

    def test_criteria_combine_and_sort_naturally(self):
        self.assertEqual(self.names([{'keyword': 'FILTER'}, {'keyword': 'EXPTIME'}]), [
            ({'FILTER': 'B', 'EXPTIME': '30'}, ['b30a', 'b30b']),
            # 15 and 15.0 are one round, named as the first file has it.
            ({'FILTER': 'V', 'EXPTIME': '15'}, ['v15a', 'v15b']), ({'FILTER': 'V', 'EXPTIME': '30'}, ['v30a'])])
        self.assertEqual(self.names([{'each': True}])[0], ({'파일': 'b30a'}, ['b30a']))
        self.assertEqual(self.names([{'expression': 'EXPTIME > 20', 'name': 'long'}]),
                         [({'long': 'False'}, ['v15a', 'v15b']), ({'long': 'True'}, ['b30a', 'b30b', 'v30a'])])
        self.assertEqual(self.names([{'keyword': 'FILTER'}, {'count': 2, 'order': 'EXPTIME'}]), [
            ({'FILTER': 'B', '묶음': '1'}, ['b30a', 'b30b']),
            ({'FILTER': 'V', '묶음': '1'}, ['v15a', 'v15b']), ({'FILTER': 'V', '묶음': '2'}, ['v30a'])])
        self.assertEqual(self.names([{'times': 2}, {'keyword': 'FILTER'}])[1:3],
                         [({'회차': '1', 'FILTER': 'V'}, ['v15a', 'v15b', 'v30a']), ({'회차': '2', 'FILTER': 'B'}, ['b30a', 'b30b'])])

    def test_chunks_are_named_by_their_files(self):
        flow = dict(criteria=[{'keyword': 'FILTER'}, {'count': 2, 'order': 'EXPTIME'}], split={'taskId': 'x'})
        self.assertEqual([step['name'] for step in rounds(flow, self.items, Items(str))], ['B 1–2', 'V 1–2', 'V 3'])
        flow = dict(criteria=[{'count': 2}], split={'taskId': 'x'})
        self.assertEqual([step['name'] for step in rounds(flow, self.items, Items(str))], ['1–2', '3–4', '5'])

    def test_condition_keeps_matching_files_in_one_round(self):
        self.assertEqual(self.names([], condition='EXPTIME > 20'), [({}, ['b30a', 'b30b', 'v30a'])])
        self.assertEqual(self.names([], condition='!(EXPTIME > 20)'), [({}, ['v15a', 'v15b'])])
        self.assertEqual(self.names([{'keyword': 'FILTER'}], condition='FILTER == "V"'), [({'FILTER': 'V'}, ['v15a', 'v15b', 'v30a'])])

    def test_times_needs_no_files(self):
        self.assertEqual([s['values'] for s in rounds({'criteria': [{'times': 3}]}, [], Items(str))],
                         [{'회차': '1'}, {'회차': '2'}, {'회차': '3'}])

    def test_invalid_settings(self):
        self.assertEqual(flow_errors({'criteria': []}), ['무엇마다 반복할지 정해 주세요.'])
        self.assertEqual(flow_errors({'criteria': [{'keyword': 'FILTER'}]}), ['나눌 파일을 골라 주세요.'])
        self.assertEqual(flow_errors({'criteria': [{'times': 3}]}), [])
        self.assertTrue(flow_errors({'criteria': [{'times': 0}]}))
        self.assertTrue(flow_errors({'criteria': [{'count': 0}], 'split': {'taskId': 'x'}}))
        self.assertTrue(flow_errors({'criteria': [{'expression': 'EXPTIME >', 'name': 'x'}], 'split': {'taskId': 'x'}}))
        self.assertTrue(flow_errors({'criteria': [{'keyword': 'name'}], 'split': {'taskId': 'x'}}))
        self.assertTrue(flow_errors({'criteria': [{'keyword': 'A'}, {'keyword': 'A'}], 'split': {'taskId': 'x'}}))
        self.assertTrue(flow_errors({'criteria': [], 'condition': 'EXPTIME >', 'split': {'taskId': 'x'}}))
        state, _ = run({'nodes': [task('a')], 'flows': [region('r', [], members=['a'])]}, Runner({}))
        self.assertEqual(state['state'], 'failed')
        self.assertIn('무엇마다', state['message'])


class ReceiveTests(unittest.TestCase):
    def graph(self, extra_links=(), nodes=()):
        return {
            'nodes': [task('science'), task('ccdproc'), *[task(n) for n in nodes]],
            'flows': [region('proc', [{'keyword': 'FILTER'}, {'keyword': 'EXPTIME'}], 'science', ['ccdproc'])],
            'links': [link('science', 'ccdproc', 'images'), *extra_links],
        }

    def test_a_round_without_a_matching_file_warns_and_runs_without_it(self):
        darks = {'Dark30.fits': EXPTIME('30'), 'Dark60.fits': EXPTIME('60')}
        graph = self.graph([link('darks', 'ccdproc', 'dark', multiple=False,
                                 flow={'proc': {'mode': 'match', 'keys': ['EXPTIME']}})], ['darks'])
        runner = Runner({'science': files(*SCIENCE, headers=SCIENCE), 'darks': files(*darks, headers=darks)})
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        self.assertEqual(runner.inputs('ccdproc', 'dark'), [['Dark30.fits'], None, ['Dark30.fits']])
        self.assertEqual(state['warnings'], [{'nodeId': 'ccdproc', 'message': 'V 15 회차에 맞는 dark가 없습니다.'}])

    def test_a_source_split_by_a_label_the_region_lacks_is_warned(self):
        graph = {
            'nodes': [task('darks'), task('average'), task('science'), task('ccdproc')],
            'flows': [region('exp', [{'keyword': 'EXPTIME'}], 'darks', ['average']),
                      region('proc', [{'keyword': 'FILTER'}], 'science', ['ccdproc'])],
            'links': [link('darks', 'average'), link('science', 'ccdproc', 'images'),
                      dict(link('average', 'ccdproc', 'dark'), id='c1')],
        }
        graph['nodes'][1]['label'] = 'Master Dark'
        runner = Runner({'darks': files(*DARKS, headers=DARKS), 'science': files(*SCIENCE, headers=SCIENCE)}, combine=['average'])
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        message = 'Master Dark는 EXPTIME마다 다릅니다. 영역에 EXPTIME를 더하면 짝을 지을 수 있습니다.'
        self.assertEqual(state['warnings'], [{'nodeId': 'ccdproc', 'message': message}])
        self.assertEqual(runner.inputs('ccdproc', 'dark'), [['average[d15_1]', 'average[d30_1]']] * 2)
        # The editor's diagnostics say the same before the run.
        issues = []
        connections = [{'id': 'c1', 'source': {'kind': 'pending', 'taskId': 'average'}, 'target': 'ccdproc', 'role': 'dark'}]
        diagnose_flows(graph['flows'], connections, lambda *a: issues.append(a), {'average': graph['nodes'][1]})
        self.assertEqual(issues, [('warning', message, 'ccdproc', 'c1')])
        # A stored match by EXPTIME is not warned.
        connections[0]['flow'] = {'proc': {'mode': 'match', 'keys': []}}
        issues.clear()
        diagnose_flows(graph['flows'], connections, lambda *a: issues.append(a), {'average': graph['nodes'][1]})
        self.assertEqual(issues, [])

    def test_inside_a_region_one_task_gives_the_next_its_round_only(self):
        """psf -> allstar inside one region: each round's one file, labelled with the round."""
        graph = {
            'nodes': [task('science'), task('psf'), task('allstar')],
            'flows': [region('loop', [{'keyword': 'FILTER'}], 'science', ['psf', 'allstar'])],
            'links': [link('science', 'psf', 'images'), link('science', 'allstar', 'images'),
                      dict(link('psf', 'allstar', 'psfimage', multiple=False), id='c1')],
        }
        runner = Runner({'science': files(*SCIENCE, headers=SCIENCE)}, combine=['psf'])
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        self.assertEqual(runner.inputs('allstar', 'psfimage'), [['psf[b30a]'], ['psf[v15a]']])
        made = [(job['instanceId'], [(p['id'], p['labels']) for p in job['products']]) for job in state['jobs'] if job['instanceId'] == 'psf']
        self.assertEqual(made, [('psf', [('psf[b30a]', {'FILTER': 'B'})]), ('psf', [('psf[v15a]', {'FILTER': 'V'})])])
        self.assertNotIn('warnings', state)
        # Nothing to warn about before the run: the connection stays inside the region.
        issues = []
        connections = [{'id': 'c1', 'source': {'kind': 'pending', 'taskId': 'psf'}, 'target': 'allstar', 'role': 'psfimage'}]
        diagnose_flows(graph['flows'], connections, lambda *a: issues.append(a), {n['id']: n for n in graph['nodes']})
        self.assertEqual(issues, [])

    def fits_files(self, headers):
        """FITS files for ids the editor resolves; returns their resolver."""
        import tempfile
        from pathlib import Path
        import numpy as np
        from astropy.io import fits
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        for name, header in headers.items():
            fits.writeto(Path(folder.name) / name, np.zeros((2, 2), dtype='float32'), fits.Header(header))
        return lambda id: str(Path(folder.name) / id)

    def test_files_the_editor_resolved_take_part(self):
        flats = {'FlatB.fits': {'FILTER': 'B'}, 'FlatV.fits': {'FILTER': 'V'}}
        graph = self.graph([link('mflat', 'ccdproc', 'flat', multiple=False, files=list(flats),
                                 flow={'proc': {'mode': 'match', 'keys': ['FILTER']}})])
        graph['flows'][0]['criteria'] = [{'keyword': 'FILTER'}]
        self.assertEqual(workflow_order(graph), ['science', 'proc'])
        runner = Runner({'science': files(*SCIENCE, headers=SCIENCE)})
        state = execute_workflow(graph, runner, lambda: False, lambda s: None, self.fits_files(flats))
        self.assertEqual(state['state'], 'completed', state['message'])
        self.assertEqual(runner.inputs('ccdproc', 'flat'), [['FlatB.fits'], ['FlatV.fits']])

    def test_split_files_of_a_source_outside_the_run(self):
        science = {f'{name}.fits': header for name, header in SCIENCE.items()}
        graph = {'nodes': [task('ccdproc')], 'links': [link('science', 'ccdproc', 'images', files=list(science))],
                 'flows': [region('proc', [{'keyword': 'FILTER'}], 'science', ['ccdproc'], splitFiles=list(science))]}
        WorkflowRequest.model_validate(graph)
        runner = Runner({})
        state = execute_workflow(graph, runner, lambda: False, lambda s: None, self.fits_files(science))
        self.assertEqual(state['state'], 'completed', state['message'])
        self.assertEqual(runner.inputs('ccdproc', 'images'), [['b30a.fits', 'b30b.fits'], ['v15a.fits', 'v15b.fits', 'v30a.fits']])


class ValueTests(unittest.TestCase):
    def test_labelled_values_follow_the_round(self):
        graph = {
            'nodes': [task('science'), task('phot')],
            'flows': [region('aperture', [{'keyword': 'FILTER'}], 'science', ['phot'])],
            'links': [link('science', 'phot', 'image')],
            'values': {
                'nodes': [{'id': 'fwhm', 'run': 'value-constant', 'partition': 'FILTER',
                           'rows': [{'name': 'fwhm', 'value': '', 'groups': {'B': '3.38', 'V': '3.07'}}]},
                          {'id': 'calc', 'run': 'value-compute', 'rows': [{'name': 'ap', 'value': 'fwhm * 2'}],
                           'inputs': {'fwhm': {'node': 'fwhm', 'output': 'fwhm'}}}],
                'links': [{'id': 'l', 'target': 'phot', 'parameter': 'fwhmpsf', 'type': 'r', 'source': {'node': 'fwhm', 'output': 'fwhm'}},
                          {'id': 'a', 'target': 'phot', 'parameter': 'photpars.apertures', 'type': 'r',
                           'source': {'node': 'calc', 'output': 'ap'}},
                          # The round's own value, from the region.
                          {'id': 'f', 'target': 'phot', 'parameter': 'filter', 'type': 's',
                           'source': {'node': 'aperture', 'output': 'FILTER'}}],
            },
        }
        runner = Runner({'science': files(*SCIENCE, headers=SCIENCE)})
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        got = [(p['parameters']['fwhmpsf'], p['parameterSets']['photpars']['apertures'], p['parameters']['filter'])
               for id, p in runner.calls if id == 'phot']
        self.assertEqual(got, [(3.38, 6.76, 'B'), (3.07, 6.14, 'V')])
        # Told to give every round all values, the parameter has two.
        graph['values']['links'][0]['flow'] = {'aperture': {'mode': 'all', 'keys': []}}
        state, _ = run(graph, Runner({'science': files(*SCIENCE, headers=SCIENCE)}))
        self.assertEqual(state['state'], 'failed')
        self.assertIn('2개', state['message'])

    def test_times_gives_its_round_number_and_output_names(self):
        graph = {'nodes': [task('image'), task('phot')], 'links': [link('image', 'phot', 'image')],
                 'flows': [region('range', [{'times': 3}], members=['phot'])],
                 'values': {'links': [{'id': 'v', 'target': 'phot', 'parameter': 'photpars.aperture', 'type': 'r',
                                       'source': {'node': 'range', 'output': '회차'}}]}}
        graph['nodes'][1]['payload']['outputs'] = {'$stdout': 'ap{회차}.txt'}
        runner = Runner({'image': files('m67.fits')})
        state, _ = run(graph, runner)
        self.assertEqual(state['state'], 'completed', state['message'])
        self.assertEqual([p['parameterSets']['photpars']['aperture'] for id, p in runner.calls if id == 'phot'], [1.0, 2.0, 3.0])
        self.assertEqual([p['outputs']['$stdout'] for id, p in runner.calls if id == 'phot'], ['ap1.txt', 'ap2.txt', 'ap3.txt'])
        self.assertEqual(runner.inputs('phot', 'image'), [['m67.fits']] * 3)
        # The node's own payload is unchanged.
        self.assertEqual(graph['nodes'][1]['payload']['outputs'], {'$stdout': 'ap{회차}.txt'})

    def test_compute_runs_once_per_label(self):
        from giraf.values import compute_value, parameter_value
        inputs = {'fwhm': {'values': [3.0, 4.0, 2.0], 'labels': [{'FILTER': 'B'}, {'FILTER': 'B'}, {'FILTER': 'V'}]},
                  'gain': {'values': [2.0], 'constant': True}}
        result = compute_value({'value': 'median(fwhm) * gain'}, inputs)
        self.assertEqual((result['values'], result['labels']), ([7.0, 4.0], [{'FILTER': 'B'}, {'FILTER': 'V'}]))
        self.assertEqual(parameter_value(result, {'FILTER': 'V'}, 'r'), 4.0)
        with self.assertRaisesRegex(ValueError, 'R 회차에 맞는 값이 없습니다'):
            parameter_value(result, {'FILTER': 'R'}, 'r')
        # Two label names: the more specific combination wins.
        both = compute_value({'value': 'a + b'}, {
            'a': {'values': [1.0, 2.0], 'labels': [{'FILTER': 'B'}, {'FILTER': 'V'}]},
            'b': {'values': [10.0, 20.0], 'labels': [{'FILTER': 'B', 'EXPTIME': '15'}, {'FILTER': 'V', 'EXPTIME': '15'}]}})
        self.assertEqual(both['values'], [11.0, 22.0])


class DiagnosticTests(unittest.TestCase):
    def test_region_settings_and_empty_regions(self):
        issues = []
        diagnose_flows([region('f', [{'keyword': 'FILTER'}])], [], lambda severity, message, node, connection=None: issues.append((severity, message)))
        self.assertEqual(issues, [('error', '나눌 파일을 골라 주세요.'), ('warning', '안에 작업이 없습니다. 반복할 작업을 이 안으로 옮겨 주세요.')])

    def test_outputs_named_the_same_every_round(self):
        member = lambda name: {'id': 'dump', 'payload': {'task': 'noao.digiphot.ptools.txdump', 'parameters': {},
                                                          'outputs': {'$stdout': name}}}
        flows = [region('outer', [{'keyword': 'FILTER'}], 'x', ['inner']), region('inner', [{'count': 5}], 'x', ['dump'])]
        for name, expected in (('M67.dat', 1), ('M67{FILTER}_{묶음}.dat', 0), ('M67{묶음}.dat', 0)):
            issues = []
            diagnose_loop_outputs(flows, {'dump': member(name)}, lambda *a, **k: issues.append(a))
            self.assertEqual(len(issues), expected, name)
        issues = []
        diagnose_loop_outputs(flows, {'dump': member('M67.dat')}, lambda *a, **k: issues.append(a))
        self.assertIn('{FILTER}, {묶음}', issues[0][1])

    def test_the_bundled_region_node_has_no_ports(self):
        from giraf.node_schema import BUNDLED, load_layers, node_definition
        layers, _ = load_layers([('giraf', BUNDLED)])
        self.assertNotIn('giraf.for', layers)
        self.assertNotIn('giraf.if', layers)
        node = node_definition('giraf.foreach', layers['giraf.foreach'])
        self.assertTrue(node['runnable'], node['reason'])
        self.assertEqual((node['run'], node['inputs'], node['outputs']), ('foreach', [], []))
        bad = dict(layers['giraf.foreach'][0], patch={**layers['giraf.foreach'][0]['patch'], 'inputs': {'x': {'kind': 'any'}}})
        self.assertFalse(node_definition('giraf.foreach', [bad])['runnable'])

    def test_regions_cannot_hold_each_other(self):
        graph = {'nodes': [task('a')], 'flows': [region('r', [{'times': 2}], members=['s']), region('s', [{'times': 2}], members=['r', 'a'])]}
        with self.assertRaisesRegex(ValueError, '감싸고'):
            workflow_order(graph)

    def test_the_korean_particles_follow_the_word(self):
        from giraf.flows import with_object, with_subject, with_topic
        self.assertEqual([with_subject(w) for w in ('dark', 'flat', 'zero', '영상', '파일', 'm67.coo', 'Bias 1')],
                         ['dark가', 'flat가', 'zero가', '영상이', '파일이', 'm67.coo가', 'Bias 1이'])
        self.assertEqual([with_topic(w) for w in ('Master Dark', '영상', 'bias')], ['Master Dark는', '영상은', 'bias는'])
        self.assertEqual(with_object('FILTER'), 'FILTER를')


if __name__ == '__main__':
    unittest.main()
