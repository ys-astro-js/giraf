"""Generic package contracts: written before implementation, including real IRAF checks."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from astropy.io import fits
from giraf.task_capabilities import read_parameters, installed_root


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.pkg = self.root / 'pkg' / 'demo'
        self.pkg.mkdir(parents=True)
        (self.pkg / 'demo.cl').write_text('package demo\ntask sample = "demo$x_demo.e"\ntask controls = "demo$controls.par"\nclbye()\n')
        (self.pkg / 'sample.par').write_text('value,r,a,2,0,10,"A value"\ncontrols,pset,h,"",,,Controls\nmode,s,h,ql\n')
        (self.pkg / 'controls.par').write_text('enabled,b,h,yes,,,Enabled\nmode,s,h,ql\n')
        self.descriptor = self.root / 'extensions.json'
        self.descriptor.write_text(json.dumps({'version': 1, 'tasks': {'demo.sample': {'inputs': [], 'outputs': []}}}))

    def tearDown(self):
        self.tmp.cleanup()

    def discover(self, **kwargs):
        from giraf.task_discovery import discover
        return discover(self.root, **kwargs)

    def test_discovery_needs_no_snapshot_and_excludes_pset_tasks(self):
        data = self.discover()
        spec = data['tasks']['demo.sample']
        self.assertEqual(spec['taskName'], 'sample')
        self.assertEqual(spec['package'], 'demo')
        self.assertTrue(spec['runnable'])
        self.assertEqual(spec['schemaSource'], 'parameters')
        self.assertEqual(spec['parameterSets'][0]['name'], 'controls')
        self.assertNotIn('demo.controls', data['tasks'])

    def test_descriptor_enables_no_input_task_and_pset_schema(self):
        data = self.discover(descriptors=[self.descriptor])
        spec = data['tasks']['demo.sample']
        self.assertTrue(spec['runnable'], spec.get('reason'))
        self.assertEqual(spec['inputs'], [])
        self.assertEqual(spec['outputs'], [])
        self.assertEqual(spec['parameterSets'][0]['parameters'][0]['type'], 'b')

    def test_namespaces_and_external_package_bootstrap(self):
        other = self.root / 'external'
        other.mkdir()
        (other / 'other.cl').write_text('package other\ntask sample = "other$x.e"\nclbye()\n')
        (other / 'sample.par').write_text('value,i,a,1,,,Value\n')
        tasks = self.discover(extra_roots=[other])['tasks']
        self.assertIn('demo.sample', tasks)
        self.assertIn('other.sample', tasks)
        self.assertEqual(tasks['other.sample']['bootstrap']['path'], str((other / 'other.cl').resolve()))

    def test_bad_descriptors_and_unresolved_psets_fail_closed(self):
        for override in ({'inputs': [{'name': 'absent', 'kind': 'image'}], 'outputs': []},
                         {'inputs': [], 'outputs': [], 'fixed': {'value;logout': 1}}):
            self.descriptor.write_text(json.dumps({'version': 1, 'tasks': {'demo.sample': override}}))
            self.assertFalse(self.discover(descriptors=[self.descriptor])['tasks']['demo.sample']['runnable'])
        (self.pkg / 'controls.par').unlink()
        self.descriptor.write_text(json.dumps({'version': 1, 'tasks': {'demo.sample': {'inputs': [], 'outputs': []}}}))
        self.assertFalse(self.discover(descriptors=[self.descriptor])['tasks']['demo.sample']['runnable'])

    def test_par_quotes_and_incomplete_schema(self):
        path = self.root / 'quoted.par'
        path.write_text("boundary,s,h,'nearest',,,'Boundary (constant,nearest,reflect,wrap)'\nsigma,r,a,,,,Sigma\n")
        pars = read_parameters(path)
        self.assertEqual(pars[0]['default'], 'nearest')
        self.assertEqual(pars[0]['prompt'], 'Boundary (constant,nearest,reflect,wrap)')
        self.assertEqual(pars[1]['default'], '')

    def test_refresh_detects_new_package_and_schema_drift(self):
        first = self.discover(descriptors=[self.descriptor])['tasks']['demo.sample']
        (self.pkg / 'sample.par').write_text('value,r,a,3,0,10,Value\n')
        second = self.discover(descriptors=[self.descriptor])['tasks']['demo.sample']
        self.assertNotEqual(first['schemaFingerprint'], second['schemaFingerprint'])

    def test_validation_and_worker_contract_without_ccd(self):
        from giraf.generic_tasks import validate_generic, GenericTaskRun
        spec = self.discover(descriptors=[self.descriptor])['tasks']['demo.sample']
        payload = {'task': spec['name'], 'parameters': {'value': 4}, 'parameterSets': {'controls': {'enabled': 'no'}}}
        m = validate_generic(spec, payload, lambda key: None)
        self.assertNotIn('ccdred', m)
        self.assertEqual(m['parameterSets']['controls']['enabled'], 'no')
        job = self.root / 'job'; job.mkdir()
        (job / 'manifest.json').write_text(json.dumps(m))
        run = GenericTaskRun(job)
        run.prepare()
        with self.assertRaises(ValueError):
            validate_generic(spec, dict(payload, parameters={'unknown': 'x'}), lambda key: None)
        with self.assertRaises(ValueError):
            validate_generic(spec, dict(payload, parameters={'value': 99}), lambda key: None)
        with self.assertRaises(ValueError):
            validate_generic(spec, dict(payload, parameterSets={'unknown': {'value': 'x'}}), lambda key: None)
        with self.assertRaises(ValueError):
            validate_generic(spec, dict(payload, filePolicy={'mode': 'direct'}), lambda key: None)
        (self.pkg / 'sample.par').write_text('value,r,a,7,,,Changed\n')
        with self.assertRaisesRegex(ValueError, '변경'):
            run.prepare()

    def test_multiple_outputs_plan_and_path_validation(self):
        from giraf.generic_tasks import validate_generic, preview_generic, GenericTaskRun
        (self.pkg / 'sample.par').write_text('a,f,h,"",,,Image\nb,f,h,"",,,Table\n')
        self.descriptor.write_text(json.dumps({'version': 1, 'tasks': {'demo.sample': {'inputs': [], 'outputs': [
            {'name': 'a', 'kind': 'image', 'default': 'A.fits'}, {'name': 'b', 'kind': 'text', 'default': 'B.txt'}]}}}))
        spec = self.discover(descriptors=[self.descriptor])['tasks']['demo.sample']
        m = validate_generic(spec, {'task': spec['name'], 'outputs': {'a': 'new.fits', 'b': 'table.txt'}}, lambda key: None)
        self.assertEqual([r['output'] for r in preview_generic(m)], ['new.fits', 'table.txt'])
        job = self.root / 'multi'; job.mkdir(); (job / 'manifest.json').write_text(json.dumps(m))
        runner = GenericTaskRun(job); runner.prepare()
        self.assertEqual(len(runner.expected), 2)
        for names in ({'a': '../escape.fits'}, {'a': '/tmp/escape.fits'}, {'bad': 'x'}):
            with self.assertRaises(ValueError):
                validate_generic(spec, {'task': spec['name'], 'outputs': names}, lambda key: None)
        with patch('giraf.generic_tasks.run_process', return_value=1):
            runner.execute()
        self.assertEqual(json.loads((job / 'status.json').read_text())['state'], 'failed')


@unittest.skipUnless(installed_root(), 'IRAF installation required')
class GenericIRAFTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        from giraf.task_catalog import catalog
        self.catalog = catalog()
        self.rows = {}

    def tearDown(self):
        self.tmp.cleanup()

    def image(self, name, data):
        path = self.root / name
        fits.writeto(path, np.asarray(data, dtype=np.float32))
        self.rows[name] = dict(id=name, name=name, label=name, path=str(path), asset='image')
        return name

    def run_task(self, task, inputs=None, parameters=None, extra=None, backend='cl'):
        from giraf.task_jobs import validate_task
        m = validate_task(dict(task=task, inputs=inputs or {}, parameters=parameters or {}, backend=backend, **(extra or {})), self.rows.__getitem__)
        job = self.root / ('job' + str(len(list(self.root.glob('job*'))))); job.mkdir()
        (job / 'manifest.json').write_text(json.dumps(m))
        proc = subprocess.run([sys.executable, '-m', 'giraf.task_worker', str(job)], cwd=job,
                              env=dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1])), capture_output=True, text=True, timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr + (job / 'task.log').read_text())
        status = json.loads((job / 'status.json').read_text())
        self.assertEqual(status['state'], 'completed', str(status) + (job / 'task.log').read_text())
        return job, json.loads((job / 'products.json').read_text())


    def test_copy_arithmetic_and_transform_both_backends(self):
        data = np.arange(30).reshape(5, 6)
        id = self.image('source.fits', data)
        for backend in ('cl', 'pyraf'):
            for task, inputs, params, expected in (
                ('images.imutil.imcopy', {'input': [id]}, {}, data),
                ('images.imutil.imarith', {'operand1': [id]}, {'op': '*', 'operand2': '2'}, data * 2),
                ('images.imgeom.imtranspose', {'input': [id]}, {}, data.T),
            ):
                with self.subTest(backend=backend, task=task):
                    job, products = self.run_task(task, inputs, params, backend=backend)
                    actual = fits.getdata(job / next(p['file'] for p in products if p['asset'] == 'image'))
                    np.testing.assert_allclose(actual, expected)
        np.testing.assert_array_equal(fits.getdata(self.rows[id]['path']), data)


    def test_spectral_arithmetic(self):
        id = self.image('spectrum.fits', np.arange(1, 33))
        for backend in ('cl', 'pyraf'):
            job, products = self.run_task('noao.onedspec.sarith', {'input1': [id]}, {'op': '*', 'input2': '2'}, backend=backend)
            image = next(p for p in products if p['asset'] == 'image')
            np.testing.assert_allclose(fits.getdata(job / image['file']).squeeze(), np.arange(1, 33) * 2)
