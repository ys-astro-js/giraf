import json
import os
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from giraf.workflow import WorkflowManager


class WorkflowPersistenceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.graph = {'nodes': [{'id': 'a', 'label': 'a', 'payload': {}}], 'links': []}
        self.manager = self.make_manager()
        self.manager.state = {'id': 'run', 'state': 'running', 'jobs': [], 'currentJob': None}
        self.manager.save({'graph': self.graph})

    def make_manager(self):
        return WorkflowManager(self.root, None, None, None, None)

    def test_unchanged_poll_does_not_rewrite_snapshot_or_change_updated_at(self):
        current = {'id': 'job', 'state': 'running', 'progress': 10}
        self.manager.save({'currentJob': current})
        snapshot = self.root / 'current.json'
        os.utime(snapshot, ns=(1000000000, 1000000000))
        before = self.manager.current()['updatedAt']
        with patch.object(Path, 'write_text', side_effect=AssertionError('unchanged state was written')):
            self.manager.save({'state': 'running', 'currentJob': deepcopy(current)})
        self.assertEqual(self.manager.current()['updatedAt'], before)
        self.manager.save({'currentJob': {**current, 'progress': 20}})
        self.assertGreater(self.manager.current()['updatedAt'], before)
        self.assertEqual(self.make_manager().current()['currentJob']['progress'], 20)

    def test_progress_snapshot_excludes_graph_and_restart_restores_it(self):
        completed = [{'id': 'job', 'products': []}]
        self.manager.save({'jobs': completed})
        snapshot = json.loads((self.root / 'current.json').read_text())
        self.assertNotIn('graph', snapshot)
        self.assertNotIn('jobs', snapshot)
        before = {p: p.read_bytes() for p in self.root.rglob('*.json') if p.name != 'current.json'}
        self.manager.save({'currentJob': {'id': 'job', 'state': 'running', 'progress': 50}})
        self.manager.save({'state': 'completed', 'currentJob': None})
        self.assertEqual({p: p.read_bytes() for p in before}, before)
        restored = self.make_manager()
        self.assertEqual(restored.current()['graph'], self.graph)
        self.assertEqual(restored.current()['jobs'][0]['id'], 'job')
        self.assertEqual(restored.current()['state'], 'completed')
        self.assertEqual(restored.membership('job'), {'id': 'run', 'step': 0})
        for index in range(10):
            self.manager.save({'jobs': [{'id': f'job-{index}', 'products': []}]})
        self.assertLessEqual(len(list(self.root.glob('jobs-*.json'))), 2)

    def test_legacy_snapshot_is_read_and_migrated_on_change(self):
        legacy = {'id': 'legacy', 'state': 'completed', 'jobs': [], 'graph': self.graph}
        (self.root / 'current.json').write_text(json.dumps(legacy))
        manager = self.make_manager()
        self.assertEqual(manager.current()['graph'], self.graph)
        manager.save({'message': 'updated'})
        self.assertNotIn('graph', json.loads((self.root / 'current.json').read_text()))
        self.assertEqual(self.make_manager().current()['graph'], self.graph)

    def test_failed_write_can_be_retried_and_input_mutation_is_not_saved(self):
        current = {'id': 'job', 'state': 'running', 'progress': 10}
        with patch.object(Path, 'replace', side_effect=OSError('disk unavailable')):
            with self.assertRaises(OSError):
                self.manager.save({'currentJob': current})
        self.manager.save({'currentJob': current})
        current['progress'] = 99
        self.assertEqual(self.manager.current()['currentJob']['progress'], 10)
        self.assertEqual(self.make_manager().current()['currentJob']['progress'], 10)
