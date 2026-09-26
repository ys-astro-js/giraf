"""Regression contracts for log, publication, catalog, and request boundaries."""
import asyncio
from copy import deepcopy
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import tracemalloc
import unittest
from unittest.mock import patch

import numpy as np
from astropy.io import fits

from giraf import server, task_catalog, task_session
from giraf.jobs import atomic_json
from giraf.model import Settings
from giraf.products import publish_product
from giraf.worker import Reduction
from tests.test_workspace import request


class ProcessLogTests(unittest.TestCase):
    def test_output_is_complete_without_retaining_the_whole_log(self):
        with tempfile.TemporaryDirectory() as tmp:
            job = Path(tmp)
            for interactive, backend in [(False, 'cl'), (True, 'pyraf')]:
                with self.subTest(interactive=interactive), (job / 'task.log').open('wb') as log:
                    tracemalloc.start()
                    try:
                        code = task_session.run_process([
                            sys.executable, '-c',
                            "import sys; chunk=b'x'*65536; "
                            "[sys.stdout.buffer.write(chunk) for _ in range(128)]; "
                            "sys.stdout.buffer.write('별 끝\\n'.encode()); sys.exit(7)",
                        ], job, log, interactive=interactive, backend=backend)
                        _, peak = tracemalloc.get_traced_memory()
                    finally:
                        tracemalloc.stop()
                self.assertEqual(code, 7)
                self.assertLess(peak, 4 * 1024 * 1024)
                self.assertEqual((job / 'task.log').read_bytes(), b'x' * (8 * 1024 * 1024) + '별 끝\n'.encode())

    def test_cancel_still_terminates_the_child(self):
        with tempfile.TemporaryDirectory() as tmp:
            job = Path(tmp)
            (job / 'cancel').touch()
            with (job / 'task.log').open('wb') as log, self.assertRaises(task_session.Cancelled):
                task_session.run_process([sys.executable, '-c', 'import time; time.sleep(30)'], job, log)
            import os
            pid = json.loads((job / 'engine-process.json').read_text())['pid']
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)

    def test_log_segment_reads_only_bytes_after_the_invocation_offset(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'task.log'
            prefix = b'previous ERROR\n' * 10000
            suffix = '새 실행\nGIRAF_RUN_DONE\n'.encode()
            path.write_bytes(prefix + suffix)
            original_open = io.open

            class CheckedStream:
                def __init__(self, stream): self.stream = stream
                def __enter__(self): return self
                def __exit__(self, *args): self.stream.close()
                def seek(self, *args): return self.stream.seek(*args)
                def read(self, *args):
                    self_case.assertGreaterEqual(self.stream.tell(), len(prefix))
                    return self.stream.read(*args)

            self_case = self
            def checked_open(candidate, *args, **kwargs):
                stream = original_open(candidate, *args, **kwargs)
                return CheckedStream(stream) if Path(candidate) == path else stream

            with patch.object(io, 'open', checked_open):
                self.assertEqual(task_session.read_log_since(path, len(prefix)), suffix.decode())


class IncrementalProductTests(unittest.TestCase):
    def test_unchanged_products_are_not_copied_again_and_changed_headers_are_published(self):
        with tempfile.TemporaryDirectory() as tmp:
            job = Path(tmp)
            atomic_json(job / 'manifest.json', {'rows': [], 'settings': Settings().to_dict()})
            runner = Reduction(job)
            with patch('giraf.worker.publish_product', wraps=publish_product) as publish:
                for index in range(6):
                    name = f'image-{index}.fits'
                    fits.writeto(job / name, np.ones((4, 4), dtype='float32'))
                    runner.product(name, name)
                runner.save_products()
                self.assertEqual(publish.call_count, 6)
                # IRAF may update a master header after its initial publication.
                fits.setval(job / 'image-0.fits', 'CCDMEAN', value=42.)
                runner.save_products()
                self.assertEqual(publish.call_count, 7)
                products = json.loads((job / 'products.json').read_text())
                self.assertEqual(fits.getheader(job / products[0]['file'])['CCDMEAN'], 42.)
                from giraf.worker import checksum
                self.assertEqual(products[0]['sha256'], checksum(job / products[0]['file']))
                # Finish/failure cleanup can add a log after products already exist.
                (job / 'worker.log').write_text('finished\n')
                runner.products.append({'file': 'worker.log', 'label': 'run.txt', 'asset': 'text', 'role': '$log'})
                runner.save_products()
                self.assertEqual(publish.call_count, 8)
                self.assertEqual(len(json.loads((job / 'products.json').read_text())), 7)

    def test_failed_publication_can_be_retried_without_losing_existing_results(self):
        with tempfile.TemporaryDirectory() as tmp:
            job = Path(tmp)
            atomic_json(job / 'manifest.json', {'rows': [], 'settings': Settings().to_dict()})
            runner = Reduction(job)
            for name in ('a', 'b'):
                (job / name).write_text(name)
            runner.products.append({'file': 'a', 'label': 'a', 'asset': 'text'})
            runner.save_products()
            runner.products.append({'file': 'b', 'label': 'b', 'asset': 'text'})
            with patch('giraf.worker.publish_product', side_effect=OSError('disk full')):
                with self.assertRaises(OSError): runner.save_products()
            self.assertEqual(len(json.loads((job / 'products.json').read_text())), 1)
            runner.save_products()
            self.assertEqual(len(json.loads((job / 'products.json').read_text())), 2)


class CatalogRequestTests(unittest.TestCase):
    def test_regular_reads_reuse_discovery_and_explicit_refresh_replaces_it(self):
        previous = deepcopy(task_catalog.TASKS)
        previous_discovery = task_catalog.DISCOVERY
        self.addCleanup(lambda: task_catalog.TASKS.update(previous))
        self.addCleanup(task_catalog.TASKS.clear)
        self.addCleanup(setattr, task_catalog, 'DISCOVERY', previous_discovery)
        discovered = {'tasks': {}, 'diagnostics': ['refreshed'], 'descriptions': {}}
        with patch('giraf.task_discovery.discover', return_value=discovered) as discover:
            for _ in range(2):
                self.assertEqual(asyncio.run(request('GET', 'catalog'))[0], 200)
            discover.assert_not_called()
            code, catalog = asyncio.run(request('GET', 'catalog', query='refresh=1'))
            self.assertEqual(code, 200)
            self.assertEqual(catalog['discovery']['diagnostics'], ['refreshed'])
            self.assertEqual(discover.call_count, 1)
            self.assertEqual(asyncio.run(request('GET', 'catalog'))[1], catalog)
            self.assertEqual(discover.call_count, 1)

    def test_failed_refresh_preserves_previous_catalog(self):
        before = deepcopy(task_catalog.TASKS)
        with patch('giraf.task_discovery.discover', side_effect=OSError('unreadable package')):
            code, _ = asyncio.run(request('GET', 'catalog', query='refresh=1'))
        self.assertEqual(code, 400)
        self.assertEqual(task_catalog.TASKS, before)

    def test_slow_catalog_and_document_storage_do_not_block_other_requests(self):
        for action, target, result in [
            ('catalog', 'giraf.server.catalog', {'tasks': []}),
            ('workflow-documents', 'giraf.server.WorkflowDocuments.list', []),
        ]:
            with self.subTest(action=action):
                entered, release = threading.Event(), threading.Event()
                released = []
                def slow(*args, **kwargs):
                    entered.set()
                    released.append(release.wait(2))
                    return result
                async def run():
                    pending = asyncio.create_task(request('GET', action))
                    try:
                        self.assertTrue(await asyncio.to_thread(entered.wait, 3))
                        self.assertEqual((await request('GET', 'not-a-route'))[0], 404)
                    finally:
                        release.set()
                    self.assertEqual((await pending)[0], 200)
                with patch(target, side_effect=slow), patch.object(server, 'workspace', {'folder': tempfile.gettempdir()}):
                    asyncio.run(run())
                self.assertEqual(released, [True], 'Synchronous storage blocked the event loop')


class TaskRequestShapeTests(unittest.TestCase):
    def test_bad_nested_types_report_fields_before_execution(self):
        cases = [
            ({'task': []}, 'task'),
            ({'parameters': []}, 'parameters'),
            ({'parameters': {'value': {}}}, 'parameters.value'),
            ({'inputs': []}, 'inputs'),
            ({'inputs': {'input': [42]}}, 'inputs.input.0'),
            ({'filePolicy': None}, 'filePolicy'),
            ({'filePolicy': {'mode': 'copy', 'backup': 'false'}}, 'filePolicy.backup'),
            ({'parameterSets': {'controls': []}}, 'parameterSets.controls'),
            ({'expressions': {'input': []}}, 'expressions.input'),
            ({'outputs': {'output': []}}, 'outputs.output'),
            ({'output': []}, 'output'),
            ({'mapping': []}, 'mapping'),
            ({'exam': {'parameters': []}}, 'exam.parameters'),
            ({'cursorCommands': {'cursor': []}}, 'cursorCommands.cursor'),
            ({'textInputs': {'coords': []}}, 'textInputs.coords'),
            ({'ccdproc': None}, 'ccdproc'),
            ({'ccdred': []}, 'ccdred'),
            ({'workingDirectory': []}, 'workingDirectory'),
        ]
        with patch.object(server, 'start_task') as launch:
            for action in ('task-validate', 'task-run'):
                for task in ('ccdproc', 'ccdhedit'):
                    for bad, field in cases:
                        with self.subTest(action=action, task=task, field=field):
                            code, data = asyncio.run(request('POST', action, {'task': task, **bad}))
                            self.assertEqual(code, 400)
                            self.assertTrue(any(issue['field'].startswith(field) for issue in data['issues']), data)
            launch.assert_not_called()

    def test_workflow_rejects_invalid_task_payload_before_launching(self):
        graph = {'nodes': [{'id': 'a', 'label': 'A', 'payload': {'task': 'ccdproc', 'inputs': []}}], 'links': []}
        with patch.object(server.workflow_manager, 'start') as start:
            code, data = asyncio.run(request('POST', 'workflow-run', graph))
            self.assertEqual(code, 400)
            self.assertTrue(any(i['field'] == 'nodes.0.payload.inputs' for i in data['issues']), data)
            start.assert_not_called()

    def test_valid_task_defaults_and_iraf_values_keep_their_contract(self):
        from giraf.task_jobs import validate_task
        payload = {'task': 'workflow.image_list', 'inputs': {}, 'outputs': {'output': 'images.list'}}
        # Required-file checks must still happen after structural validation.
        with self.assertRaisesRegex(ValueError, '입력 파일'):
            validate_task(payload, lambda _: None)
        from giraf.request_schema import TaskRequest
        valid = {'task': 'sample', 'parameters': {'a': 'INDEF', 'b': '1:30', 'c': True, 'd': 2.5},
                 'workingDirectory': None, 'instanceId': None, 'fileConfirmation': None}
        self.assertEqual(TaskRequest.model_validate(valid).model_dump(exclude_unset=True), valid)

