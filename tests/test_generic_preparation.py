"""Manifest-to-job contracts specified before extracting the preparation layer."""
import json
import tempfile
import unittest
from pathlib import Path

from giraf.generic_tasks import GenericTaskRun
from giraf.task_discovery import file_hash


class GenericPreparationTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.job = self.root / 'job'
        self.job.mkdir()
        rows = []
        for name in ('a', 'b'):
            path = self.root / (name + '.fits')
            path.write_bytes(name.encode())
            rows.append(dict(id=name, name=path.name, path=str(path), sha256=file_hash(path)))
        self.manifest = dict(
            definition=dict(schemaFiles={}, inputs=[dict(name='input'), dict(name='operand', scalar=True)],
                            outputs=[dict(name='output', kind='image', mode='each'),
                                     dict(name='optional', kind='text', mode='single', optional=True)],
                            parameters=[], parameterSets=[], loadPackages=['images'],
                            qualified='images.demo', taskName='demo'),
            rows=rows, inputs={'input': ['a', 'b'], 'operand': []},
            parameters={'operand': '2'}, parameterSets={}, outputs={'output': 'r_', 'optional': ''},
            cursorCommands={'events': 'q'}, textInputs={'coords': '1 2\n'},
        )

    def prepare(self):
        (self.job / 'manifest.json').write_text(json.dumps(self.manifest))
        runner = GenericTaskRun(self.job)
        runner.prepare()
        return runner

    def test_native_lists_scalar_inline_records_and_optional_outputs(self):
        runner = self.prepare()
        self.assertEqual(len(runner.calls), 1)
        params, expected = runner.calls[0]
        self.assertEqual(params['operand'], '2')
        self.assertEqual(params['optional'], '')
        self.assertEqual((self.job / params['input'][1:]).read_text(), 'input/s00000.fits\ninput/s00001.fits\n')
        self.assertEqual((self.job / params['output'][1:]).read_text(), 'output/o00000.fits\noutput/o00001.fits\n')
        self.assertEqual((self.job / params['events']).read_text(), 'q\n')
        self.assertEqual((self.job / params['coords']).read_text(), '1 2\n')
        self.assertEqual([p['label'] for p in expected], ['r_a.fits', 'r_b.fits'])
        self.assertEqual((self.job / 'input/s00000.fits').read_bytes(), b'a')
        self.assertEqual(len(json.loads((self.job / 'sources.json').read_text())), 2)
        for suffix in ('cl', 'py'):
            script = (self.job / ('commands.' + suffix)).read_text()
            self.assertIn('GIRAF_GENERIC_DONE', script)
            self.assertIn('@lists/input.list', script)

    def test_prefix_output_paths_follow_staged_names(self):
        self.manifest['definition']['outputs'][0]['naming'] = 'prefix'
        runner = self.prepare()
        self.assertEqual(runner.calls[0][0]['output'], 'output/output_')
        self.assertEqual([p['file'] for p in runner.expected], ['output/output_s00000.fits', 'output/output_s00001.fits'])

    def test_source_changes_and_missing_primary_input_fail_before_execution(self):
        (self.root / 'a.fits').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, '검증 이후 변경'):
            self.prepare()
        self.manifest['rows'] = []
        self.manifest['inputs']['input'] = []
        with self.assertRaisesRegex(ValueError, '입력 파일이 필요'):
            self.prepare()
