"""Node schema v2 layers over IRAF inference (docs/node-schema.md)."""
import json
from pathlib import Path
import tempfile
import unittest


class NodeSchemaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        pkg = self.root / 'pkg' / 'demo'
        pkg.mkdir(parents=True)
        (pkg / 'demo.cl').write_text('package demo\ntask measure = "demo$x.e"\ntask datapars = "demo$datapars.par"\nclbye()\n')
        (pkg / 'measure.par').write_text(
            'image,f,a,"",,,Input images\ncoords,s,h,"",,,Coordinate list\noutput,f,h,"",,,Output table\n'
            'verify,b,h,yes,,,Verify parameters\nsigma,r,h,2.5,0,10,Noise\ndatapars,pset,h,"",,,Data\nmode,s,h,ql\n')
        (pkg / 'datapars.par').write_text('fwhmpsf,r,h,2.5,0,,FWHM\nitime,r,h,1,,,Exposure time\nmode,s,h,ql\n')
        self.giraf = self.root / 'giraf-schemas'
        self.user = self.root / 'user-schemas'
        self.giraf.mkdir()
        self.user.mkdir()

    def write(self, folder, data, name='measure.json'):
        (folder / name).write_text(json.dumps({'version': 2, 'task': 'demo.measure', **data}))

    def discover(self):
        from giraf.task_discovery import discover
        return discover(self.root, schema_directories=[('giraf', self.giraf), ('user', self.user)])

    def spec(self):
        return self.discover()['tasks']['demo.measure']

    def test_layers_patch_ports_by_name_and_record_provenance(self):
        self.write(self.giraf, {'inputs': {'image': {'label': '영상'}, 'coords': {'kind': 'text'}}})
        self.write(self.user, {'inputs': {'image': {'label': '입력 영상'}}, 'outputs': {'output': None}, 'title': '측정'})
        s = self.spec()
        self.assertTrue(s['runnable'], s['reason'])
        inputs = {p['name']: p for p in s['inputs']}
        self.assertEqual(inputs['image']['label'], '입력 영상')
        self.assertEqual(inputs['image']['kind'], 'image')
        self.assertEqual(inputs['coords']['kind'], 'text')
        self.assertNotIn('output', [p['name'] for p in s['outputs']])
        self.assertEqual(s['title'], '측정')
        self.assertEqual(s['schemaProvenance']['inputs.image.label'], 'user')
        self.assertEqual(s['schemaProvenance']['inputs.coords.kind'], 'giraf')
        self.assertEqual([l['layer'] for l in s['schemaLayers']], ['giraf', 'user'])

    def test_schema_file_changes_the_fingerprint(self):
        first = self.spec()['schemaFingerprint']
        self.write(self.user, {'parameters': {'sigma': {'label': 'σ'}}})
        second = self.spec()
        self.assertNotEqual(first, second['schemaFingerprint'])
        self.assertEqual(next(p for p in second['parameters'] if p['name'] == 'sigma')['label'], 'σ')

    def test_fixed_values_are_hidden_and_win_over_stored_node_values(self):
        from giraf.generic_tasks import validate_generic
        self.write(self.user, {'parameters': {'verify': {'fixed': 'no'}, 'datapars.itime': {'fixed': 90}}})
        s = self.spec()
        self.assertNotIn('verify', [p['name'] for p in s['parameters']])
        group = s['parameterSets'][-1]
        self.assertEqual(group['name'], 'datapars')
        self.assertEqual(group['fixed'], {'itime': 90.0})
        self.assertEqual([p['name'] for p in group['parameters']], ['fwhmpsf'])
        payload = {'task': s['name'], 'parameters': {'verify': 'no', 'sigma': 3},
                   'parameterSets': {'datapars': {'fwhmpsf': 7.5, 'itime': 60}}}
        m = validate_generic(s, payload, lambda key: None)
        self.assertEqual(m['parameterSets']['datapars'], {'fwhmpsf': 7.5, 'itime': 90.0})
        self.assertEqual(m['warnings'], ['datapars.itime: 노드 값 60 대신 스키마 고정값 90.0을 사용합니다.'])

    def test_fixed_pset_values_are_written_to_the_task_scripts(self):
        from giraf.generic_tasks import validate_generic
        from giraf.generic_tasks.scripts import write_scripts
        self.write(self.user, {'parameters': {'datapars.itime': {'fixed': 90}}})
        s = self.spec()
        m = validate_generic(s, {'task': s['name']}, lambda key: None)
        job = self.root / 'job'
        job.mkdir()
        write_scripts(job, m, [])
        self.assertIn('demo.datapars.itime = 90.0', (job / 'commands.cl').read_text())

    def test_new_node_defaults_and_groups(self):
        self.write(self.user, {'parameters': {'datapars.fwhmpsf': {'default': 7.5}},
                               'groups': [{'label': '측광', 'parameters': ['datapars.fwhmpsf', 'sigma', 'absent']}]})
        s = self.spec()
        self.assertTrue(s['runnable'], s['reason'])
        self.assertEqual(s['parameterSets'][-1]['parameters'][0]['default'], 7.5)
        self.assertEqual(s['groups'], [{'label': '측광', 'parameters': ['datapars.fwhmpsf', 'sigma']}])
        self.assertEqual([i['severity'] for i in s['schemaIssues']], ['warning'])

    def test_unknown_references_warn_and_keep_the_task_runnable(self):
        self.write(self.user, {'inputs': {'gone': {'kind': 'image'}, 'sigma': {'label': 'no kind'}},
                               'parameters': {'datapars.gone': {'label': 'x'}, 'image': {'fixed': 'a.fits'}}})
        s = self.spec()
        self.assertTrue(s['runnable'], s['reason'])
        messages = [i['message'] for i in s['schemaIssues']]
        self.assertEqual(len(messages), 4, messages)
        self.assertTrue(all(i['severity'] == 'warning' for i in s['schemaIssues']))
        self.assertIn('image', [p['name'] for p in s['inputs']])

    def test_format_errors_fail_closed(self):
        for data in ({'version': 1}, {'inputs': []}, {'inputs': {'image': {'kind': 'photo'}}},
                     {'parameters': {'sigma': {'hidden': True}}}, {'components': [{'type': 'image-cursor'}]}):
            with self.subTest(data=data):
                self.write(self.user, data)
                s = self.spec()
                self.assertFalse(s['runnable'])
                self.assertIn('measure.json', s['reason'])

    def test_files_without_a_known_task_are_reported(self):
        (self.user / 'broken.json').write_text('{')
        (self.user / 'other.json').write_text(json.dumps({'version': 2, 'task': 'demo.absent'}))
        diagnostics = self.discover()['diagnostics']
        self.assertTrue(any('broken.json' in d for d in diagnostics))
        self.assertTrue(any('demo.absent' in d for d in diagnostics))


if __name__ == '__main__':
    unittest.main()
