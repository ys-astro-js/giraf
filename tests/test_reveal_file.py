import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import asyncio
from tests.test_workspace import request
from giraf import server


class RevealFileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'image with spaces.fits'
        self.path.write_text('data')
        for p in [patch.object(server, 'registry', {'known': {'path': str(self.path)}}),
                  patch.object(server, 'workspace', {'file_refs': {}})]:
            p.start()
            self.addCleanup(p.stop)

    def test_platform_commands_preserve_file_path(self):
        for platform, command in [('darwin', ['open', '-R', str(self.path)]),
                                  ('win32', ['explorer', '/select,', str(self.path)]),
                                  ('linux', ['xdg-open', str(self.path.parent)])]:
            with self.subTest(platform=platform), patch.object(server.sys, 'platform', platform), patch.object(server.subprocess, 'run') as run:
                self.assertEqual(asyncio.run(request('POST', 'reveal', {'id': 'known'}))[0], 200)
                self.assertEqual(run.call_args.args[0], command)
                self.assertNotIn('shell', run.call_args.kwargs)

    def test_invalid_requests_do_not_launch(self):
        with patch.object(server.subprocess, 'run') as run:
            self.assertEqual(asyncio.run(request('GET', 'reveal', query='id=known'))[0], 405)
            self.assertEqual(asyncio.run(request('POST', 'reveal', {'id': 'unknown'}))[0], 400)
            self.assertEqual(asyncio.run(request('POST', 'reveal', {'id': 'known'}, origin='https://example.com'))[0], 403)
            self.path.unlink()
            self.assertEqual(asyncio.run(request('POST', 'reveal', {'id': 'known'}))[0], 400)
            run.assert_not_called()

    def test_launch_failure_has_actionable_message(self):
        with patch.object(server.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'open')):
            code, data = asyncio.run(request('POST', 'reveal', {'id': 'known'}))
            self.assertEqual(code, 400)
            self.assertIn('파일 위치', data['error'])
