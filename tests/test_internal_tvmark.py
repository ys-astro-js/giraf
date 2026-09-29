"""Internal tvmark must never write to a user's external display."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from giraf.generic_tasks import GenericTaskRun
from giraf.task_jobs import start_task


class InternalTvmarkTests(unittest.TestCase):
    def test_api_launch_rejects_native_tvmark_before_starting_a_process(self):
        manifest = {'task': 'images.tv.tvmark', 'adapter': 'generic'}
        with tempfile.TemporaryDirectory() as tmp, patch('giraf.task_jobs.subprocess.Popen') as launch, patch('giraf.task_jobs.RUNS') as runs:
            runs.__truediv__.side_effect = lambda name: Path(tmp) / name
            with self.assertRaisesRegex(ValueError, '내부.*뷰어'):
                start_task(manifest, tmp)
            launch.assert_not_called()
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_previously_queued_jobs_cannot_reach_ds9_on_either_backend(self):
        for backend in ('cl', 'pyraf'):
            with self.subTest(backend=backend), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp)
                (path / 'manifest.json').write_text(json.dumps({
                    'task': 'images.tv.tvmark', 'backend': backend,
                    'definition': {'name': 'images.tv.tvmark'},
                }))
                with patch.object(GenericTaskRun, 'prepare') as prepare, patch('giraf.generic_tasks.execution.run_process') as launch:
                    with self.assertRaisesRegex(ValueError, '내부.*뷰어'):
                        GenericTaskRun(path).execute()
                    prepare.assert_not_called()
                    launch.assert_not_called()
