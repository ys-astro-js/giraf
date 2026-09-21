import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from giraf import server


class LibraryDeleteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.runs = self.root / 'runs'
        self.runs.mkdir()
        self.trash = self.root / 'trash'
        self.trash.mkdir()
        self.registry = {}
        self.workspace = {'folder': str(self.root), 'sets': [], 'overrides': {}, 'file_refs': {}}
        self.patches = [patch.object(server, 'send2trash', side_effect=lambda path: Path(path).rename(self.trash / Path(path).name), create=True), patch.object(server, 'RUNS', self.runs), patch.object(server, 'registry', self.registry),
                        patch.object(server, 'workspace', self.workspace), patch.object(server, 'STATE', self.root / 'workspace.json'),
                        patch.object(server.workflow_manager, 'current', return_value=None)]
        for p in self.patches: p.start()
        self.addCleanup(self.tmp.cleanup)
        for p in self.patches: self.addCleanup(p.stop)

    def job(self, name, state='completed'):
        path = self.runs / name
        path.mkdir()
        (path / 'manifest.json').write_text(json.dumps({'settings': {}, 'rows': []}))
        (path / 'status.json').write_text(json.dumps({'state': state}))
        return path

    def file(self, name='source.txt', job=None):
        path = self.root / name
        path.write_text('science data')
        row = server.register(path, job=job, asset='text')
        self.workspace['file_refs'][row['id']] = {'path': str(path)}
        return row, path

    def test_file_delete_removes_disk_file_and_saved_references(self):
        row, path = self.file()
        other, keep = self.file('keep.txt')
        self.workspace['sets'] = [{'ids': [row['id'], other['id']]}]
        result = server.delete_library('files', [row['id']])
        self.assertFalse(path.exists())
        self.assertTrue(keep.exists())
        self.assertEqual((self.trash / path.name).read_text(), 'science data')
        self.assertEqual(result['fileIds'], [row['id']])
        self.assertNotIn(row['id'], self.registry)
        self.assertNotIn(row['id'], self.workspace['file_refs'])
        self.assertEqual(self.workspace['sets'][0]['ids'], [other['id']])

    def test_invalid_batch_is_validated_before_deleting_anything(self):
        row, path = self.file()
        with self.assertRaises(ValueError): server.delete_library('files', [row['id'], 'unknown'])
        self.assertTrue(path.exists())
        with self.assertRaises(ValueError): server.delete_library('jobs', ['../outside'])
        with patch.object(server, 'send2trash', side_effect=OSError('Trash unavailable')):
            with self.assertRaisesRegex(ValueError, '휴지통'): server.delete_library('files', [row['id']])
        self.assertTrue(path.exists())
        self.assertIn(row['id'], self.registry)
        self.assertIn(row['id'], self.workspace['file_refs'])
        other, keep = self.file('keep.txt')
        def move_or_fail(target):
            target = Path(target)
            if target.resolve() == keep.resolve(): raise OSError('Trash unavailable')
            target.rename(self.trash / target.name)
        with patch.object(server, 'send2trash', side_effect=move_or_fail):
            result = server.delete_library('files', [row['id'], other['id']])
        self.assertEqual(result['failedIds'], [other['id']])
        self.assertEqual(result['fileIds'], [row['id']])
        self.assertTrue(keep.exists())
        self.assertIn(other['id'], self.workspace['file_refs'])

    def test_active_jobs_block_deletion(self):
        self.job('active', 'running')
        row, path = self.file()
        with self.assertRaises(ValueError): server.delete_library('files', [row['id']])
        with self.assertRaises(ValueError): server.delete_library('jobs', ['active'])
        self.assertTrue(path.exists())

    def test_job_delete_removes_only_selected_run_and_its_registered_products(self):
        run = self.job('old')
        keep = self.job('keep')
        row, source = self.file()
        product = run / 'output.txt'
        product.write_text('output')
        output = server.register(product, job='old', asset='text')
        current = {'state': 'completed', 'jobs': [{'id': 'old', 'products': [output]}, {'id': 'keep', 'products': []}], 'currentJob': {'id': 'old', 'products': [output]}}
        with patch.object(server.workflow_manager, 'current', return_value=current), patch.object(server.workflow_manager, 'save') as save:
            result = server.delete_library('jobs', ['old'])
            saved = save.call_args.args[0]
            self.assertEqual([job['id'] for job in saved['jobs']], ['keep'])
            self.assertIsNone(saved['currentJob'])
        self.assertFalse(run.exists())
        self.assertEqual((self.trash / 'old' / 'output.txt').read_text(), 'output')
        self.assertTrue((self.trash / 'old' / 'manifest.json').exists())
        self.assertTrue(keep.exists())
        self.assertTrue(source.exists())
        self.assertIn(output['id'], result['fileIds'])
        self.assertEqual(result['jobIds'], ['old'])

    def test_deleting_product_updates_job_product_listing(self):
        run = self.job('old')
        path = run / 'output.txt'
        path.write_text('output')
        row = server.register(path, job='old', asset='text')
        (run / 'products.json').write_text(json.dumps([{'file': 'output.txt', 'label': 'output.txt'}]))
        server.delete_library('files', [row['id']])
        self.assertEqual(json.loads((run / 'products.json').read_text()), [])
