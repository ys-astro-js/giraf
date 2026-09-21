import json
from pathlib import Path
import unittest
from tempfile import TemporaryDirectory
from giraf.workflow_documents import WorkflowDocuments


class WorkflowDocumentTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.tmp_path = Path(self.directory.name)

    def test_empty_folder_does_not_write_until_saved(self):
        tmp_path = self.tmp_path
        store = WorkflowDocuments(tmp_path)
        draft = store.new()
        assert store.list() == []
        store.write(draft)
        assert store.read(draft['_document']['path'])['_document']['name'] == '새 워크플로우'


    def test_nested_discovery_and_rename_preserve_content(self):
        tmp_path = self.tmp_path
        child = tmp_path / 'child'
        child.mkdir()
        nested = WorkflowDocuments(child)
        draft = nested.new()
        draft['taskMap']['tasks'] = [{'id': 'original'}]
        nested.write(draft)
        store = WorkflowDocuments(tmp_path)
        item = store.list()[0]
        assert item['folder'] == 'child'
        draft['_document']['name'] = '보정'
        store.write(draft)
        assert store.read(item['path'])['taskMap']['tasks'] == [{'id': 'original'}]
        assert store.list()[0]['name'] == '보정'


    def test_invalid_import_and_outside_paths_are_rejected(self):
        tmp_path = self.tmp_path
        store = WorkflowDocuments(tmp_path)
        with self.assertRaises(ValueError):
            store.import_document({'taskMap': {'tasks': 'invalid'}})
        draft = store.new()
        draft['_document']['path'] = str(tmp_path.parent / 'outside.json')
        with self.assertRaises(ValueError):
            store.write(draft)
        assert store.list() == []


    def test_import_is_copy_and_broken_files_do_not_hide_valid_ones(self):
        tmp_path = self.tmp_path
        store = WorkflowDocuments(tmp_path)
        original = store.new()
        store.write(original)
        imported = store.import_document(original)
        assert imported['_document']['path'] != original['_document']['path']
        path = Path(original['_document']['path']).parent / 'broken.json'
        path.write_text('{')
        assert len(store.list()) == 2
        assert json.loads(Path(imported['_document']['path']).read_text())['format'] == 'giraf-workflow'
