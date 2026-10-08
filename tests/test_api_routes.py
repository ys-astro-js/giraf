import asyncio
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from astropy.io import fits

from giraf import server
from tests.test_workspace import request


class ApiRouteTests(unittest.TestCase):
    def test_methods_are_rejected_before_handlers_run(self):
        posts = ('workflow-diagnostics', 'workflow-run', 'workflow-cancel', 'workflow-confirm',
                 'task-run', 'task-validate', 'task-respond', 'task-cancel', 'folder',
                 'delete-files', 'delete-jobs', 'metadata', 'alignment-star', 'validate', 'run', 'reveal')
        gets = ('catalog', 'workflow', 'header', 'task-graphics', 'text', 'plot', 'workspace',
                'browse', 'info', 'image', 'pixel', 'jobs', 'job', 'download')
        for method, actions in [('GET', posts), ('POST', gets)]:
            for action in actions:
                with self.subTest(method=method, action=action):
                    code, data = asyncio.run(request(method, action))
                    self.assertEqual(code, 405)
                    self.assertIsInstance(data['error'], str)

    def test_unknown_api_is_json_404_and_read_routes_keep_their_payloads(self):
        self.assertEqual(asyncio.run(request('GET', 'not-a-route'))[0], 404)
        with patch.object(server, 'catalog', return_value={'tasks': []}):
            self.assertEqual(asyncio.run(request('GET', 'catalog')), (200, {'tasks': []}))

    def test_validation_has_nested_field_paths_and_does_not_save_invalid_document(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = {'folder': tmp, 'sets': [], 'overrides': {}}
            with patch.object(server, 'workspace', state), patch.object(server, 'STATE', root / 'state.json'):
                code, draft = asyncio.run(request('GET', 'task-preferences'))
                self.assertEqual(code, 200)
                draft['taskMap']['view']['zoom'] = 'invalid'
                code, data = asyncio.run(request('POST', 'task-preferences', draft))
                self.assertEqual(code, 400)
                self.assertTrue(any('taskMap.view.zoom' in issue['field'] for issue in data['issues']))
                self.assertFalse(Path(draft['_document']['path']).exists())
                code, _ = asyncio.run(request('POST', 'task-preferences', ['bad']))
                self.assertEqual(code, 400)

    def test_home_lists_recent_folders_and_keeps_the_startup_setting(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first, second = root / 'M51', root / 'NGC2420'
            for folder in (first, second):
                folder.mkdir()
                fits.writeto(folder / 'object.fits', np.zeros((2, 2)))
            state = {'folder': str(first), 'sets': [], 'overrides': {}}
            with patch.object(server, 'workspace', state), patch.object(server, 'STATE', root / 'state.json'):
                code, data = asyncio.run(request('GET', 'home'))
                self.assertEqual((code, data['startup'], data['recent']), (200, 'home', []))
                self.assertEqual(set(data['engines']), {'cl', 'pyraf'})
                for folder in (first, second, first):
                    self.assertEqual(asyncio.run(request('POST', 'folder', {'path': str(folder)}))[0], 200)
                rows = asyncio.run(request('GET', 'home'))[1]['recent']
                self.assertEqual([row['name'] for row in rows], ['M51', 'NGC2420'])
                shutil.rmtree(second)
                self.assertEqual([row['name'] for row in asyncio.run(request('GET', 'home'))[1]['recent']], ['M51'])
                self.assertEqual(asyncio.run(request('POST', 'home', {'startup': 'resume'}))[1]['startup'], 'resume')
                self.assertEqual(asyncio.run(request('POST', 'home', {'startup': 'other'}))[0], 400)
                self.assertEqual(state['startup'], 'resume')

    def test_origin_guard_still_blocks_mutation(self):
        with patch.object(server.workflow_manager, 'cancel') as cancel:
            self.assertEqual(asyncio.run(request('POST', 'workflow-cancel', {}, origin='https://example.com'))[0], 403)
            cancel.assert_not_called()
