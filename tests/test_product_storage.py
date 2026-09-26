"""Published products retain their displayed filenames and immutable contents."""
import asyncio
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import unquote

import numpy as np
from astropy.io import fits

from giraf.generic_tasks import GenericTaskRun, preview_generic, validate_generic
from giraf.image_lists import image_list_spec
from giraf.jobs import atomic_json
from giraf.task_jobs import preview_task, validate_task, authorize_file_plan
from giraf.task_worker import TaskRun
from tests.test_tasks import NO_CORRECTIONS


def assert_products(case, job, products):
    for p in products:
        path = job / p['file']
        case.assertEqual(path.name, p['label'])
        case.assertTrue(path.is_file())
        case.assertEqual(Path(p['file']).parts[0], 'products')
        case.assertEqual(len(Path(p['file']).parts), 3)
        case.assertEqual(p['sha256'], hashlib.sha256(path.read_bytes()).hexdigest())


class ProductStorageTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name).resolve()
        self.rows = {}
        for key in ('a', 'b'):
            path = self.root / (key + '.fit')
            fits.writeto(path, np.ones((8, 8), dtype='float32'))
            self.rows[key] = dict(id=key, path=str(path), name=path.name,
                                  label='한글 영상.fit', asset='image')
        self.spec = dict(image_list_spec(), name='demo.sample', taskName='sample',
                         executor=None, qualified='demo.sample', package='demo',
                         outputs=[dict(name='output', kind='image', mode='single', default='결과 영상')])

    def job(self, manifest):
        job = self.root / ('job' + str(len(list(self.root.glob('job*')))))
        job.mkdir(); atomic_json(job / 'manifest.json', manifest)
        return job

    def generic(self, spec=None, outputs=None, fail_indices=()):
        m = validate_generic(spec or self.spec, dict(backend='pyraf', inputs={'input': ['a', 'b']},
                             outputs=outputs or {}), self.rows.__getitem__)
        job = self.job(m); runner = GenericTaskRun(job)
        call = 0
        def execute(command, directory, log, **kwargs):
            nonlocal call
            for p in runner.calls[call][1]:
                fits.writeto(job / p['file'], np.full((8, 8), call + 1, dtype='float32'))
            failed = call in fail_indices; call += 1
            log.write(b'ERROR: failure\n' if failed else b'GIRAF_GENERIC_DONE\n'); log.flush()
            return int(failed)
        original_prepare = runner.prepare
        def prepare():
            original_prepare()
            if fail_indices or (spec or self.spec)['outputs'][0]['mode'] == 'each':
                runner.calls = [(runner.calls[0][0], [p]) for p in runner.expected]
        with patch.object(runner, 'prepare', side_effect=prepare), patch.object(runner, 'write_scripts', side_effect=lambda index=None: [(job / ('commands.' + ext)).write_text('') for ext in ('cl', 'py')]), patch('giraf.generic_tasks.execution.run_process', side_effect=execute):
            runner.execute()
        products = json.loads((job / 'products.json').read_text())
        assert_products(self, job, products)
        return m, job, products

    def test_single_extension_unicode_log_and_api_names(self):
        m, job, products = self.generic()
        self.assertEqual(preview_generic(m)[0]['output'], '결과 영상.fits')
        self.assertEqual(products[0]['label'], '결과 영상.fits')
        self.assertEqual(products[-1]['label'], 'sample-results.txt')
        self.assertEqual((job / products[0]['file']).read_bytes(), (job / 'output/o00000.fits').read_bytes())
        from giraf import server
        from starlette.requests import Request
        with patch.object(server, 'registry', {}), patch.object(server, 'workspace', {'overrides': {}, 'file_refs': {}}):
            for p in products:
                row = server.register(job / p['file'], p['label'], job.name, p['asset'])
                self.assertEqual(row['name'], row['label'])
                self.assertEqual(server.get_file(row['id']).name, p['label'])
                request = Request({'type': 'http', 'method': 'GET', 'path': '/api/download',
                                   'path_params': {'action': 'download'}, 'query_string': ('id=' + row['id']).encode(), 'headers': []})
                response = asyncio.run(server.download_endpoint(request))
                self.assertIn(p['label'], unquote(response.headers['content-disposition']))
                from tests.test_workspace import request as api_request
                with patch.object(server.sys, 'platform', 'darwin'), patch.object(server.subprocess, 'run') as reveal:
                    self.assertEqual(asyncio.run(api_request('POST', 'reveal', {'id': row['id']}))[0], 200)
                    self.assertEqual(Path(reveal.call_args.args[0][-1]).name, row['label'])

    def test_each_duplicate_names_preserve_extension_and_sources(self):
        spec = deepcopy(self.spec); spec['outputs'][0]['mode'] = 'each'
        m, job, products = self.generic(spec, {'output': '보정 '})
        images = products[:-1]
        self.assertEqual([p['label'] for p in images], ['보정 한글 영상.fit'] * 2)
        self.assertEqual([p['source'] for p in images], ['a', 'b'])
        self.assertNotEqual(images[0]['file'], images[1]['file'])
        self.assertEqual([p['output'] for p in preview_generic(m)], [p['label'] for p in images])
        for i, p in enumerate(images):
            np.testing.assert_array_equal(fits.getdata(job / p['file']), i + 1)
        spec['outputs'][0]['naming'] = 'prefix'
        _, prefix_job, prefix_products = self.generic(spec, {'output': 'prefix_'})
        self.assertEqual(prefix_products[0]['label'], 'prefix_한글 영상.fit')
        self.assertEqual((prefix_job / prefix_products[0]['file']).read_bytes(), (prefix_job / 'output/output_s00000.fit').read_bytes())

    def test_duplicate_output_roles_and_existing_extensions(self):
        spec = deepcopy(self.spec)
        spec['outputs'].append(dict(spec['outputs'][0], name='second'))
        _, _, products = self.generic(spec, {'output': 'same.fts', 'second': 'same.fts'})
        self.assertEqual([p['label'] for p in products[:-1]], ['same.fts', 'same.fts'])
        self.assertNotEqual(products[0]['file'], products[1]['file'])
        from giraf import server
        from starlette.requests import Request
        job = self.root / 'job0'
        with patch.object(server, 'registry', {}), patch.object(server, 'workspace', {'overrides': {}}):
            row = server.register(job / products[0]['file'], products[0]['label'], job.name, 'image')
            request = Request({'type': 'http', 'method': 'GET', 'path_params': {'action': 'download'},
                               'query_string': ('id=' + row['id']).encode(), 'headers': []})
            response = asyncio.run(server.download_endpoint(request))
            self.assertEqual(response.headers['content-disposition'], 'attachment; filename="same.fts"')

    def test_invalid_names_are_rejected_before_execution(self):
        for name in ('', ' ', '.', '..', '../bad', 'a/b', 'a\\b', 'bad\tname', 'bad\x01name', 'bad\x7fname', 'bad\x85name'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                validate_generic(self.spec, dict(inputs={'input': ['a']}, outputs={'output': name}), self.rows.__getitem__)

    def test_partial_and_failed_calls_only_publish_accepted_outputs_and_log(self):
        spec = deepcopy(self.spec); spec['outputs'][0]['mode'] = 'each'
        for failed, state, count in [((1,), 'partial', 2), ((0, 1), 'failed', 1)]:
            _, job, products = self.generic(spec, {'output': 'p'}, failed)
            self.assertEqual(json.loads((job / 'status.json').read_text())['state'], state)
            self.assertEqual(len(products), count)

    def test_image_list_and_log_preserve_content(self):
        m = validate_generic(image_list_spec(), dict(inputs={'input': ['a']}, outputs={'output': '영상 목록.list'}), self.rows.__getitem__)
        job = self.job(m); GenericTaskRun(job).execute()
        products = json.loads((job / 'products.json').read_text()); assert_products(self, job, products)
        self.assertEqual(products[0]['label'], '영상 목록.list')
        self.assertEqual((job / products[0]['file']).read_bytes(), (job / 'output/images.list').read_bytes())
        self.assertEqual(products[-1]['role'], '$log')

    def test_legacy_paths_prefix_lists_and_direct_backup(self):
        from giraf.task_catalog import TASKS, definition
        legacy = definition('ccdproc', [dict(name='images', label='Images', kind='image', multiple=True, required=True)],
                            dict(name='output', mode='each', default='p'))
        catalog_patch = patch.dict(TASKS, {'ccdproc': legacy})
        catalog_patch.start(); self.addCleanup(catalog_patch.stop)
        for output in ('보정 ', 'nested/result', 'nested/result.fit', '@outputs.list'):
            (self.root / 'outputs.list').write_text('nested/목록 결과\n')
            m = validate_task(dict(task='ccdproc', inputs={'images': ['a']}, parameters=NO_CORRECTIONS,
                                  output={'name': output}, workingDirectory=str(self.root)), self.rows.__getitem__)
            job = self.job(m); runner = TaskRun(job); runner.prepare()
            self.assertEqual(preview_task(m)[0]['output'], runner.expected[0]['label'])
            self.assertEqual(Path(runner.expected[0]['label']).name, runner.expected[0]['label'])
            self.assertTrue(Path(runner.expected[0]['label']).suffix)
        m = validate_task(dict(task='ccdhedit', backend='cl', inputs={'images': ['a']},
                              parameters={'parameter': 'OBSERVER', 'value': 'tester'},
                              filePolicy={'mode': 'direct', 'backup': True}), self.rows.__getitem__)
        authorize_file_plan(m, m['filePlan']['token'])
        job = self.job(m); runner = TaskRun(job)
        before = Path(self.rows['a']['path']).read_bytes()
        runner.execute()
        products = json.loads((job / 'products.json').read_text()); assert_products(self, job, products)
        self.assertEqual(products[0]['target'], self.rows['a']['path'])
        self.assertEqual((job / 'backup/s00000.fit').read_bytes(), before)
        self.assertEqual(fits.getheader(job / products[0]['file'])['OBSERVER'], 'tester')

    def test_existing_result_lookup_does_not_migrate_files(self):
        from giraf import server
        job = self.job({'rows': [], 'workspace_folder': str(self.root)})
        (job / 'old.txt').write_text('old')
        atomic_json(job / 'products.json', [dict(file='old.txt', label='Old display', asset='text')])
        atomic_json(job / 'status.json', {'state': 'completed'})
        before = (job / 'products.json').read_bytes()
        with patch.object(server, 'RUNS', self.root), patch.object(server, 'registry', {}), patch.object(server, 'workspace', {'folder': str(self.root), 'overrides': {}, 'sets': []}):
            row = next(r for r in server.files() if r['label'] == 'Old display')
            self.assertEqual(row['path'], str(job / 'old.txt'))
        self.assertEqual((job / 'products.json').read_bytes(), before)
        self.assertFalse((job / 'products').exists())

    def test_missing_old_result_keeps_display_name_in_validation_and_execution(self):
        from giraf import server
        path = self.root / 'o00000.fits'
        fits.writeto(path, np.ones((8, 8), dtype='float32'))
        row = server.register(path, '보정한 영상.fits', 'old-run')
        resolve = lambda id: row
        payloads = [dict(task='images.imutil.imcopy', inputs={'input': [row['id']]}),
                    dict(task='ccdhedit', inputs={'images': [row['id']]}, parameters={'parameter': 'OBSERVER', 'value': 'test'}),
                    dict(task='workflow.image_list', inputs={'input': [row['id']]})]
        manifests = [validate_task(p, resolve) for p in payloads]
        path.unlink()
        for payload, manifest in zip(payloads, manifests):
            runner = (GenericTaskRun if manifest.get('adapter') == 'generic' else TaskRun)(self.job(manifest))
            for action in (lambda: validate_task(payload, resolve), runner.execute):
                with self.assertRaises(ValueError) as caught:
                    action()
                self.assertIn(row['label'], str(caught.exception))
                self.assertNotIn(path.name, str(caught.exception))
