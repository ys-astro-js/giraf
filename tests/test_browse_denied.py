import asyncio
import pathlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tests.test_workspace import request
from giraf import server


class BrowseDeniedEntriesTests(unittest.TestCase):
    """Windows folders seen from WSL hold entries whose stat is denied."""

    def test_denied_entries_are_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'Application Data').mkdir()
            (Path(tmp) / 'Data').mkdir()
            (Path(tmp) / 'image.fits').write_text('data')
            is_dir = pathlib.Path.is_dir

            def denied(path):
                if path.name == 'Application Data':
                    raise PermissionError(13, 'Permission denied', str(path))
                return is_dir(path)

            with patch.object(pathlib.Path, 'is_dir', denied), patch.object(server, 'registry', {}), \
                    patch.object(server, 'workspace', {'folder': tmp, 'sets': [], 'overrides': {}, 'file_refs': {}}):
                code, data = asyncio.run(request('GET', 'browse', query=f'path={tmp}'))
        self.assertEqual(code, 200)
        self.assertEqual([d['name'] for d in data['directories']], ['Data'])
        self.assertEqual(data['fits'], 1)


if __name__ == '__main__':
    unittest.main()
