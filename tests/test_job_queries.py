import asyncio
import io
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from giraf import server
from tests.test_workspace import request


class JobQueryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.job = self.root / 'run'
        self.job.mkdir()
        (self.job / 'manifest.json').write_text(json.dumps({'rows': [], 'settings': {}}))
        (self.job / 'status.json').write_text(json.dumps({'state': 'completed'}))
        self.runs = patch.object(server, 'RUNS', self.root)
        self.runs.start()
        self.addCleanup(self.runs.stop)

    def details(self):
        return asyncio.run(request('GET', 'job', query='id=run&details=1'))

    def test_slow_job_storage_does_not_block_other_requests(self):
        for action, query in [('jobs', ''), ('job', 'id=run&details=1')]:
            with self.subTest(action=action):
                entered, release = threading.Event(), threading.Event()
                resumed = []
                original = server.job_info

                def slow_info(job):
                    entered.set()
                    resumed.append(release.wait(1))
                    return original(job)

                async def concurrent_requests():
                    pending = asyncio.create_task(request('GET', action, query=query))
                    try:
                        self.assertTrue(await asyncio.to_thread(entered.wait, 2))
                        self.assertEqual((await request('GET', 'not-a-route'))[0], 404)
                    finally:
                        release.set()
                    self.assertEqual((await pending)[0], 200)

                with patch.object(server, 'job_info', slow_info):
                    asyncio.run(concurrent_requests())
                self.assertEqual(resumed, [True], 'Storage blocked the event loop')

    def test_log_tail_is_bounded_and_preserves_decoded_character_limits(self):
        for name, limit in [('worker.log', 24000), ('task.log', 80000)]:
            for content in [b'', b'short\r\nlog\rline',
                            ('prefix' * 100000 + '별🌠\r\n' * limit).encode() + b'\xffend']:
                with self.subTest(name=name, length=len(content)):
                    path = self.job / name
                    path.write_bytes(content)
                    expected = path.read_text(errors='replace')[-limit:]
                    original_open = io.open
                    read_sizes = []

                    class TrackedLog:
                        def __init__(self, stream):
                            self.stream = stream

                        def __enter__(self):
                            return self

                        def __exit__(self, *args):
                            self.stream.close()

                        def seek(self, *args):
                            return self.stream.seek(*args)

                        def tell(self):
                            return self.stream.tell()

                        def read(self, size=-1):
                            read_sizes.append(size)
                            if size < 0 or sum(read_sizes) > 4 * limit:
                                raise AssertionError('Log read must be bounded')
                            return self.stream.read(size)

                    def tracked_open(candidate, *args, **kwargs):
                        stream = original_open(candidate, *args, **kwargs)
                        return TrackedLog(stream) if Path(candidate).resolve() == path.resolve() else stream

                    with patch.object(io, 'open', tracked_open):
                        code, data = self.details()
                    self.assertEqual(code, 200)
                    self.assertEqual(data['log'], expected)
                    self.assertTrue(read_sizes)
                    path.unlink()

    def test_task_log_takes_precedence_without_reading_worker_log(self):
        (self.job / 'worker.log').write_text('worker')
        (self.job / 'task.log').write_text('task')
        (self.job / 'commands.py').write_text('print("run")')
        original_open = io.open

        def open_without_worker(path, *args, **kwargs):
            if Path(path).resolve() == (self.job / 'worker.log').resolve():
                raise AssertionError('Superseded worker log should not be read')
            return original_open(path, *args, **kwargs)

        with patch.object(io, 'open', open_without_worker):
            code, data = self.details()
        self.assertEqual(code, 200)
        self.assertEqual(data['log'], 'task')
        self.assertEqual(data['commands'], 'print("run")')

    def test_missing_logs_summary_and_invalid_job_keep_existing_contract(self):
        code, data = self.details()
        self.assertEqual((code, data['log'], data['commands']), (200, '', ''))
        code, summary = asyncio.run(request('GET', 'job', query='id=run'))
        self.assertEqual(code, 200)
        self.assertNotIn('log', summary)
        code, jobs = asyncio.run(request('GET', 'jobs'))
        self.assertEqual((code, [job['id'] for job in jobs]), (200, ['run']))
        for query in ['id=missing', 'id=../outside']:
            self.assertEqual(asyncio.run(request('GET', 'job', query=query))[0], 400)
