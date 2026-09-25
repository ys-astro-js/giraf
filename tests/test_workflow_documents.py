import json
from pathlib import Path
import unittest
from tempfile import TemporaryDirectory
from giraf.workflow_documents import WorkflowDocuments


class WorkflowDocumentTests(unittest.TestCase):
    def test_nested_types_are_checked_on_import_read_and_write(self):
        from copy import deepcopy
        store = WorkflowDocuments(self.tmp_path)
        good = store.new()
        good['taskMap']['tasks'] = [{
            'id': 'n', 'task': 'imcopy', 'label': '복사',
            'draft': {'parameters': {}, 'inputs': {'input': ['file']}, 'output': {}, 'exam': {}},
            'preprocess': {}, 'mapping': {}, 'packageValues': {},
            'expressions': {}, 'filePolicy': {}, 'instrument': [],
        }]
        good['taskMap']['connections'] = [{'id': 'e', 'target': 'n', 'role': 'input',
                                         'source': {'kind': 'files', 'ids': ['file'], 'label': '자료'}}]
        store.write(good)
        path = Path(good['_document']['path'])
        mutations = [
            lambda g: g['tasks'][0]['draft']['inputs'].update(input=[123]),
            lambda g: g['tasks'][0].update(instrument='file'),
            lambda g: g['connections'][0].update(target=123),
            lambda g: g['connections'][0]['source'].update(kind='unknown'),
            lambda g: g['view'].update(zoom='1'),
            lambda g: g.update(version=2),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                bad = deepcopy(good)
                mutate(bad['taskMap'])
                with self.assertRaises(ValueError):
                    store.write(bad)
                with self.assertRaises(ValueError):
                    store.import_document(bad)
                disk = {'format': 'giraf-workflow', 'version': 1, 'name': '문서',
                        'preferences': {}, 'taskMap': bad['taskMap']}
                path.write_text(json.dumps(disk))
                with self.assertRaises(ValueError):
                    store.read(str(path))

    def test_unknown_extension_fields_and_legacy_sparse_nodes_round_trip(self):
        store = WorkflowDocuments(self.tmp_path)
        draft = store.new()
        draft['taskMap']['tasks'] = [{'id': 'legacy', 'extension': {'enabled': True}}]
        draft['customPreference'] = {'value': 7}
        store.write(draft)
        restored = store.read(draft['_document']['path'])
        self.assertEqual(restored['taskMap'], draft['taskMap'])
        self.assertEqual(restored['customPreference'], draft['customPreference'])

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
