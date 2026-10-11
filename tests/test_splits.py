import unittest
from copy import deepcopy

from giraf.request_schema import WorkflowRequest
from giraf.splits import (Files, SplitError, apply_formulas, group_outputs, group_runs, output_suffix,
                          pair_files, part_errors, split_groups, split_problems, with_suffix)
from giraf.workflow import execute_workflow


def headers(table):
    """Files whose headers (and names) come from `table`: {id: {KEY: value}}."""
    return Files(lambda id: f'/missing/{id}', lambda id: id, lambda id: table.get(id, {}))


EXPTIME = lambda value: {'EXPTIME': value}
DARKS = {**{f'd15_{n}.fits': EXPTIME('15') for n in range(1, 8)}, **{f'd30_{n}.fits': EXPTIME('30.0') for n in range(1, 4)}}
SCIENCE = {'b1.fits': {'FILTER': 'B', 'EXPTIME': '90'}, 'b2.fits': {'FILTER': 'B', 'EXPTIME': '90'},
           'v1.fits': {'FILTER': 'V', 'EXPTIME': '60'}, 'v2.fits': {'FILTER': 'V', 'EXPTIME': '60'}}
CALIBRATIONS = {'Dark90.fits': {'EXPTIME': '90.0'}, 'Dark60.fits': {'EXPTIME': '60'},
                'FlatB.fits': {'FILTER': 'B'}, 'FlatV.fits': {'FILTER': 'V'}}


class GroupTests(unittest.TestCase):
    def test_a_key_groups_by_header_and_sorts_numbers_as_numbers(self):
        files = headers({'a': EXPTIME('100'), 'b': EXPTIME('15.0'), 'c': EXPTIME('30'), 'd': EXPTIME('15')})
        groups = split_groups(['a', 'b', 'c', 'd'], [{'key': 'EXPTIME'}], files)
        # 15 and 15.0 are one group; 100 sorts after 30 as a number.
        self.assertEqual([(g['id'], g['files']) for g in groups], [('15', ['b', 'd']), ('30', ['c']), ('100', ['a'])])
        self.assertEqual(groups[0]['keys'], {'EXPTIME': '15'})

    def test_text_values_sort_as_text_and_a_missing_key_is_last(self):
        files = headers({'a': {'FILTER': 'V'}, 'b': {'FILTER': 'B'}, 'c': {}})
        groups = split_groups(['a', 'b', 'c'], [{'key': 'FILTER'}], files)
        self.assertEqual([(g['id'], g['name']) for g in groups], [('B', 'B'), ('V', 'V'), ('', '없음')])

    def test_per_chunks_in_file_name_order_with_a_smaller_last_group(self):
        ids = [f'z{n}.fits' for n in (10, 2, 1, 3, 4, 5, 6, 7, 8, 9, 11, 12)]
        groups = split_groups(ids, [{'per': 5}], headers({}))
        self.assertEqual([g['name'] for g in groups], ['1–5', '6–10', '11–12'])
        self.assertEqual(groups[0]['files'], ['z1.fits', 'z2.fits', 'z3.fits', 'z4.fits', 'z5.fits'])
        self.assertEqual([g['id'] for g in groups], ['1', '2', '3'])
        self.assertEqual(groups[0]['suffix'], '1')

    def test_each_makes_one_group_per_file(self):
        groups = split_groups(['m67v.fits', 'm67b.fits'], [{'each': True}], headers({}))
        self.assertEqual([(g['id'], g['files']) for g in groups], [('m67b', ['m67b.fits']), ('m67v', ['m67v.fits'])])

    def test_parts_combine_key_then_per(self):
        groups = split_groups(list(DARKS), [{'key': 'EXPTIME'}, {'per': 5}], headers(DARKS))
        self.assertEqual([(g['name'], len(g['files'])) for g in groups], [('15 1–5', 5), ('15 6–7', 2), ('30 1–3', 3)])
        self.assertEqual([g['id'] for g in groups], ['15/1', '15/2', '30/1'])
        self.assertEqual([g['suffix'] for g in groups], ['15-1', '15-2', '30-1'])

    def test_two_keys_and_a_single_file_chunk(self):
        groups = split_groups(list(SCIENCE), [{'key': 'FILTER'}, {'key': 'EXPTIME'}], headers(SCIENCE))
        self.assertEqual([(g['id'], g['suffix']) for g in groups], [('B/90', 'B90'), ('V/60', 'V60')])
        one = split_groups(['a', 'b', 'c'], [{'per': 2}], headers({}))
        self.assertEqual([g['name'] for g in one], ['1–2', '3'])

    def test_invalid_parts(self):
        self.assertEqual(part_errors({'input': 'input', 'by': [{'key': 'EXPTIME'}]}), [])
        self.assertTrue(part_errors({'input': 'input', 'by': [{'key': '1bad'}]}))
        self.assertTrue(part_errors({'input': 'input', 'by': [{'per': 0}]}))
        self.assertTrue(part_errors({'input': 'input', 'by': [{'other': 1}]}))
        self.assertTrue(part_errors({'by': [{'each': True}]}))


class NamingTests(unittest.TestCase):
    def test_suffixes(self):
        self.assertEqual(output_suffix(['15', '1'], ['key', 'per']), '15-1')
        self.assertEqual(output_suffix(['1'], ['per']), '1')
        self.assertEqual(output_suffix(['B'], ['key']), 'B')
        self.assertEqual(output_suffix(['B', '90'], ['key', 'key']), 'B90')
        self.assertEqual(with_suffix('Dark.fits', '15-1'), 'Dark15-1.fits')
        self.assertEqual(with_suffix('Zero', '1'), 'Zero1')
        self.assertEqual(with_suffix('NGC2420', 'B'), 'NGC2420B')
        self.assertEqual(with_suffix('m67.coo.1', 'B'), 'm67B.coo.1')
        self.assertEqual(with_suffix('out/Flat.fits', 'V'), 'out/FlatV.fits')

    def test_only_single_outputs_take_the_suffix(self):
        generic = {'adapter': 'generic', 'outputs': [
            {'name': 'output', 'mode': 'single', 'default': 'Combined.fits'},
            {'name': 'each', 'mode': 'each', 'default': 'p_'},
            {'name': 'sigma', 'mode': 'single', 'default': '', 'optional': True},
            {'name': 'named', 'mode': 'single', 'default': '{name}.coo'}]}
        payload = group_outputs(generic, {'outputs': {'output': 'NGC2420', 'each': 'p_'}}, 'B')
        self.assertEqual(payload['outputs'], {'output': 'NGC2420B', 'each': 'p_'})
        adapter = {'output': {'name': 'output', 'mode': 'combine', 'default': 'Dark.fits'}}
        self.assertEqual(group_outputs(adapter, {}, '15-1')['output'], {'name': 'Dark15-1.fits'})
        each = {'output': {'name': 'output', 'mode': 'each', 'default': 'p'}}
        self.assertEqual(group_outputs(each, {'output': {'name': 'p'}}, 'B')['output'], {'name': 'p'})


class PairingTests(unittest.TestCase):
    def setUp(self):
        self.files = headers({**SCIENCE, **CALIBRATIONS})
        self.groups = split_groups(list(SCIENCE), [{'key': 'FILTER'}], self.files)

    def test_by_key_picks_the_candidate_with_the_groups_value(self):
        darks = pair_files('dark', {'by': 'EXPTIME'}, ['Dark60.fits', 'Dark90.fits'], self.groups, self.files)
        self.assertEqual(darks, {'B': ['Dark90.fits'], 'V': ['Dark60.fits']})
        flats = pair_files('flat', {'by': 'FILTER'}, ['FlatV.fits', 'FlatB.fits'], self.groups, self.files)
        self.assertEqual(flats, {'B': ['FlatB.fits'], 'V': ['FlatV.fits']})

    def test_by_key_mismatches_name_the_group(self):
        with self.assertRaisesRegex(SplitError, 'V: EXPTIME 60에 맞는 dark 파일이 없습니다'):
            pair_files('dark', {'by': 'EXPTIME'}, ['Dark90.fits', 'FlatB.fits'], self.groups, self.files)
        twice = headers({**SCIENCE, 'a': EXPTIME('90'), 'b': EXPTIME('90.0'), 'c': EXPTIME('60')})
        with self.assertRaisesRegex(SplitError, 'B: EXPTIME 90에 맞는 dark 파일이 2개입니다'):
            pair_files('dark', {'by': 'EXPTIME'}, ['a', 'b', 'c'], self.groups, twice)
        mixed = headers({'b1': {'FILTER': 'B', 'EXPTIME': '90'}, 'b2': {'FILTER': 'B', 'EXPTIME': '30'}})
        groups = split_groups(['b1', 'b2'], [{'key': 'FILTER'}], mixed)
        with self.assertRaisesRegex(SplitError, 'B: 나눈 파일의 EXPTIME 값이 서로 다릅니다'):
            pair_files('dark', {'by': 'EXPTIME'}, ['x', 'y'], groups, mixed)

    def test_order_iraf_and_manual(self):
        self.assertEqual(pair_files('flat', {'order': True}, ['FlatB.fits', 'FlatV.fits'], self.groups, self.files),
                         {'B': ['FlatB.fits'], 'V': ['FlatV.fits']})
        with self.assertRaisesRegex(SplitError, '순서대로'):
            pair_files('flat', {'order': True}, ['FlatB.fits'], self.groups, self.files)
        self.assertEqual(pair_files('flat', {'iraf': True}, ['FlatB.fits', 'FlatV.fits'], self.groups, self.files),
                         {'B': ['FlatB.fits', 'FlatV.fits'], 'V': ['FlatB.fits', 'FlatV.fits']})
        manual = {'manual': {'B': 'FlatV.fits', 'V': 'FlatB.fits'}}
        self.assertEqual(pair_files('flat', manual, ['FlatB.fits', 'FlatV.fits'], self.groups, self.files),
                         {'B': ['FlatV.fits'], 'V': ['FlatB.fits']})
        with self.assertRaisesRegex(SplitError, 'V: flat 파일을 골라 주세요'):
            pair_files('flat', {'manual': {'B': 'FlatB.fits'}}, ['FlatB.fits', 'FlatV.fits'], self.groups, self.files)

    def test_no_rule_is_never_guessed(self):
        with self.assertRaisesRegex(SplitError, '짝 맞추기를 정하세요'):
            pair_files('flat', None, ['FlatB.fits', 'FlatV.fits'], self.groups, self.files)

    def test_problems_of_a_payload(self):
        payload = {'task': 'x', 'split': {'input': 'images', 'by': [{'key': 'FILTER'}]},
                   'inputs': {'images': list(SCIENCE), 'zero': ['Zero.fits'], 'flat': ['FlatB.fits', 'FlatV.fits'],
                              'dark': ['Dark90.fits']}}
        self.assertEqual(split_problems(payload, self.files), [('warning', 'flat: 짝 맞추기를 정하세요', 'flat')])
        payload['pairing'] = {'flat': {'by': 'EXPTIME'}}
        self.assertEqual(split_problems(payload, self.files)[0][0], 'error')
        payload['pairing'] = {'flat': {'by': 'FILTER'}}
        self.assertEqual(split_problems(payload, self.files), [])
        # A source still to run decides at the run.
        self.assertEqual(split_problems({**payload, 'pairing': {}}, self.files, {'flat'}), [])


class GroupRunTests(unittest.TestCase):
    def test_one_payload_per_group_with_paired_inputs_values_and_names(self):
        files = headers({**SCIENCE, **CALIBRATIONS})
        spec = {'adapter': 'generic', 'outputs': [{'name': 'output', 'mode': 'single', 'default': 'NGC2420'}]}
        payload = {'task': 'x', 'parameters': {'combine': 'median'},
                   'split': {'input': 'images', 'by': [{'key': 'FILTER'}]},
                   'pairing': {'dark': {'by': 'EXPTIME'}},
                   'groupValues': {'combine': {'V': 'average'}, 'datapars.fwhmpsf': {'B': 7.8, 'V': 8.6}},
                   'inputs': {'images': list(SCIENCE), 'zero': ['Zero.fits'], 'dark': ['Dark60.fits', 'Dark90.fits']}}
        runs = group_runs(payload, files, spec)
        self.assertEqual([g['id'] for g, _ in runs], ['B', 'V'])
        b, v = runs[0][1], runs[1][1]
        self.assertEqual(b['inputs'], {'images': ['b1.fits', 'b2.fits'], 'zero': ['Zero.fits'], 'dark': ['Dark90.fits']})
        self.assertEqual(v['inputs']['dark'], ['Dark60.fits'])
        self.assertEqual((b['parameters']['combine'], v['parameters']['combine']), ('median', 'average'))
        self.assertEqual(v['parameterSets'], {'datapars': {'fwhmpsf': 8.6}})
        self.assertEqual((b['outputs']['output'], v['outputs']['output']), ('NGC2420B', 'NGC2420V'))

    def test_without_a_split_the_task_runs_once(self):
        payload = {'task': 'x', 'inputs': {'input': ['a', 'b']}}
        self.assertEqual(group_runs(payload, headers({})), [(None, payload)])

    def test_formulas_read_the_tasks_other_parameters(self):
        payload = {'parameters': {}, 'parameterSets': {'datapars': {'fwhmpsf': 7.8}, 'photpars': {}},
                   'formulas': {'photpars.apertures': '3 * fwhmpsf', 'fitskypars.annulus': '4 * datapars.fwhmpsf'}}
        with self.assertRaisesRegex(SplitError, 'annulus'):
            apply_formulas(deepcopy(payload))
        payload['formulas'] = {'photpars.apertures': '3 * fwhmpsf', 'fitskypars.dannulus': 'apertures + 1'}
        done = apply_formulas(payload)
        self.assertAlmostEqual(done['parameterSets']['photpars']['apertures'], 23.4)
        self.assertAlmostEqual(done['parameterSets']['fitskypars']['dannulus'], 24.4)


class SelectTests(unittest.TestCase):
    def test_a_selection_keeps_files_by_header_before_splitting(self):
        files = headers(SCIENCE)
        payload = {'inputs': {'image': list(SCIENCE)}, 'select': {'image': {'key': 'FILTER', 'values': ['B']}}}
        [(group, only)] = group_runs(payload, files)
        self.assertIsNone(group)
        self.assertEqual(only['inputs']['image'], ['b1.fits', 'b2.fits'])
        payload['split'] = {'input': 'image', 'by': [{'key': 'EXPTIME'}]}
        payload['select'] = {'image': {'key': 'EXPTIME', 'values': ['60', '90.0']}}
        self.assertEqual([g['id'] for g, _ in group_runs(payload, files)], ['60', '90'])


class GroupValueTests(unittest.TestCase):
    def test_a_value_set_per_group_reaches_that_groups_run(self):
        from giraf.values import ValueGraph
        request = {'nodes': [{'id': 'm', 'run': 'value-constant', 'rows': [{'name': 'fwhm', 'value': ''}],
                              'groupValues': {'fwhm': {'B': '3.4', 'V': '3.1'}}},
                             {'id': 'c', 'run': 'value-compute', 'rows': [{'name': 'ap', 'value': '3 * fwhm'}],
                              'inputs': {'fwhm': {'node': 'm', 'output': 'fwhm'}}}],
                   'links': [{'id': 'l', 'target': 'phot', 'parameter': 'apertures', 'type': 'r', 'source': {'node': 'c', 'output': 'ap'}}]}
        graph = ValueGraph(request, lambda id: None, str)
        self.assertIn('2개', graph.parameters('phot')['l']['error'])
        self.assertAlmostEqual(graph.scoped({}, 'B').parameters('phot')['l']['value'], 10.2)
        self.assertAlmostEqual(graph.scoped({}, 'V').parameters('phot')['l']['value'], 9.3)
        # A plain value stands for groups the node has no value for.
        request['nodes'][0]['rows'][0]['value'] = '3.0'
        self.assertAlmostEqual(ValueGraph(request, lambda id: None, str).scoped({}, 'R').parameters('phot')['l']['value'], 9.0)


class CommandTests(unittest.TestCase):
    def test_cl_arguments_read_as_cl(self):
        from giraf.commands import argument, differs, literal
        self.assertEqual([literal(v) for v in ('@input.list', 'Dark15-1.fits', '/', '[1:10]', '', 3.0, 2.5)],
                         ['@input.list', 'Dark15-1.fits', '"/"', '"[1:10]"', '""', '3', '2.5'])
        self.assertEqual((argument('zerocor', 'yes', 'b'), argument('zerocor', 'no', 'b')), ('zerocor+', 'zerocor-'))
        self.assertEqual(argument('combine', 'median', 's'), 'combine=median')
        self.assertFalse(differs('3', 3.0))
        self.assertTrue(differs('median', 'average'))

    def test_draft_whose_input_list_is_missing_still_reads_as_its_line(self):
        """A list the upstream task has not written yet stops validation, not the line."""
        import tempfile
        from giraf import server
        with tempfile.TemporaryDirectory() as tmp:
            payload = dict(task='images.immatch.imcombine', expressions={'input': '@input.list'},
                           parameters={'combine': 'median'}, outputs={'output': 'Bias.fits'}, workingDirectory=tmp)
            with self.assertRaisesRegex(ValueError, '목록 파일이 없습니다'):
                server.validate_task(payload, lambda id: None, diagnostics=True)
            group = server.task_commands(dict(node='n', payload=payload, values={}))['groups'][0]
        line = group['lines'][0]
        self.assertTrue(line['text'].startswith('imcombine @input.list output=Bias.fits'), line['text'])
        self.assertIn('combine=median', line['text'])
        # The problem is the diagnostics' (its field `input`); the line names where that field reads.
        token = next(t for t in line['tokens'] if t['name'] == 'input')
        self.assertEqual(line['text'][token['start']:token['end']], '@input.list')
        self.assertNotIn('issues', line)
        self.assertNotIn('problem', group)

    def test_spans_cover_each_value_and_pending_inputs_read_as_lists(self):
        from giraf.commands import command_lines, draft_manifest
        manifest = draft_manifest(dict(task='images.immatch.imcombine', parameters={'combine': 'median', 'lthreshold': 'x'},
                                       outputs={'output': 'Bias.fits'}), lambda id: None)
        [(line, tokens)] = command_lines(manifest, frozenset({'input'}))
        spans = {t['name']: line[t['start']:t['end']] for t in tokens}
        self.assertEqual((spans['input'], spans['output'], spans['combine'], spans['lthreshold']), ('@input.list', 'Bias.fits', 'median', 'x'))

    def test_pset_values_are_named_by_their_field(self):
        """A parameter set's value reads under the key the editor gives it (`pset.name`)."""
        from giraf.commands import command_lines, draft_manifest
        manifest = draft_manifest(dict(task='noao.digiphot.apphot.phot', parameterSets={'datapars': {'fwhmpsf': '7.5'}}), lambda id: None)
        [(line, tokens)] = command_lines(manifest)
        token = next(t for t in tokens if t['name'] == 'datapars.fwhmpsf')
        self.assertEqual(line[token['start']:token['end']], '7.5')


class Runner:
    """Each run makes one product named after its first input."""

    def __init__(self):
        self.calls = []

    def __call__(self, node, payload):
        self.calls.append((node, deepcopy(payload)))
        first = next((ids[0] for ids in payload['inputs'].values() if ids), 'none')
        return {'id': f'{node["id"]}-{len(self.calls)}', 'state': 'completed',
                'products': [{'id': f'{node["id"]}[{first}]', 'asset': 'image', 'role': 'output'}]}


def task(id, payload):
    return {'id': id, 'label': id, 'payload': {'task': 'fake', 'parameters': {}, **payload}}


class WorkflowSplitTests(unittest.TestCase):
    def run_graph(self, graph, table):
        WorkflowRequest.model_validate(graph)
        runner = Runner()
        describe = lambda id: {'label': id, 'headers': table.get(id, {})}
        state = execute_workflow(graph, runner, lambda: False, lambda s: None, lambda id: f'/missing/{id}', describe)
        return state, runner

    def test_one_iraf_call_per_group_and_every_result_goes_on(self):
        graph = {'nodes': [task('dc', {'inputs': {'input': list(DARKS)}, 'split': {'input': 'input', 'by': [{'key': 'EXPTIME'}, {'per': 5}]}}),
                           task('next', {'inputs': {}})],
                 'links': [{'source': 'dc', 'target': 'next', 'role': 'input', 'kind': 'image', 'multiple': True}]}
        state, runner = self.run_graph(graph, DARKS)
        self.assertEqual(state['state'], 'completed', state['message'])
        calls = [(node.get('group', {}).get('name'), payload['inputs']['input']) for node, payload in runner.calls if node['id'] == 'dc']
        self.assertEqual([(name, len(ids)) for name, ids in calls], [('15 1–5', 5), ('15 6–7', 2), ('30 1–3', 3)])
        # No GIRAF-only field reaches IRAF validation.
        self.assertFalse(any('split' in payload for _, payload in runner.calls))
        gathered = [payload for node, payload in runner.calls if node['id'] == 'next'][0]['inputs']['input']
        self.assertEqual(gathered, ['dc[d15_1.fits]', 'dc[d15_6.fits]', 'dc[d30_1.fits]'])

    def test_calibrations_pair_by_header_and_a_missing_rule_stops_the_run(self):
        table = {**SCIENCE, **CALIBRATIONS}
        node = task('ccd', {'inputs': {'images': list(SCIENCE), 'dark': ['Dark90.fits', 'Dark60.fits'], 'flat': ['FlatB.fits', 'FlatV.fits']},
                            'split': {'input': 'images', 'by': [{'key': 'FILTER'}]},
                            'pairing': {'dark': {'by': 'EXPTIME'}}})
        state, runner = self.run_graph({'nodes': [node]}, table)
        self.assertEqual(state['state'], 'failed')
        self.assertIn('짝 맞추기를 정하세요', state['message'])
        self.assertEqual(runner.calls, [])
        node['payload']['pairing']['flat'] = {'by': 'FILTER'}
        state, runner = self.run_graph({'nodes': [node]}, table)
        self.assertEqual(state['state'], 'completed', state['message'])
        self.assertEqual([(p['inputs']['dark'], p['inputs']['flat']) for _, p in runner.calls],
                         [(['Dark90.fits'], ['FlatB.fits']), (['Dark60.fits'], ['FlatV.fits'])])

    def test_a_group_reads_the_value_its_own_group_measured(self):
        graph = {'nodes': [task('edit', {'inputs': {'image': ['b.fits', 'v.fits']}, 'split': {'input': 'image', 'by': [{'each': True}]}}),
                           task('phot', {'inputs': {'image': ['b.fits', 'v.fits']}, 'split': {'input': 'image', 'by': [{'each': True}]},
                                         'formulas': {'apertures': '3 * fwhmpsf'}})],
                 'values': {'links': [{'id': 'l', 'target': 'phot', 'parameter': 'fwhmpsf', 'type': 'r',
                                       'source': {'node': 'edit', 'output': 'fwhm'}}]}}
        from unittest import mock
        measured = {'edit-1': 3.0, 'edit-2': 4.0}
        with mock.patch('giraf.values.task_value', lambda job, name, resolve: {'kind': 'real', 'values': [measured[job['id']]]}):
            state, runner = self.run_graph(graph, {})
        self.assertEqual(state['state'], 'completed', state['message'])
        phot = [p['parameters'] for node, p in runner.calls if node['id'] == 'phot']
        self.assertEqual([(p['fwhmpsf'], p['apertures']) for p in phot], [(3.0, 9), (4.0, 12)])


if __name__ == '__main__':
    unittest.main()
