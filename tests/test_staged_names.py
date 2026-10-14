"""IRAF opens the run's copies under the inputs' own names and records those."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from astropy.io import fits

from giraf.jobs import ROOT, atomic_json
from giraf.staging import MAX_PATH, iraf_safe, staged_names
from giraf.task_capabilities import installed_root
from tests.iraf_required import requires_irafcl


class StagedNameTests(unittest.TestCase):
    def test_sources_keep_their_names(self):
        self.assertEqual(staged_names('/job/input', [('/a/x.fits', 'x.fits', 's00000.fits'), ('/a/y.fits', 'y.fits', 's00001.fits')]),
                         ['x.fits', 'y.fits'])

    def test_one_source_staged_twice_keeps_one_name(self):
        self.assertEqual(staged_names('/job/input', [('/a/x.fits', 'x.fits', 's00000.fits'), ('/a/x.fits', 'x.fits', 's00001.fits')]),
                         ['x.fits', 'x.fits'])

    def test_different_sources_with_one_name_are_numbered_in_order(self):
        wanted = [('/a/x.fits', 'x.fits', 's00000.fits'), ('/b/x.fits', 'x.fits', 's00001.fits'),
                  ('/c/X.FITS', 'X.FITS', 's00002.FITS'), ('/d/x_2.fits', 'x_2.fits', 's00003.fits')]
        # x_2.fits is a real name and stays; the second x.fits takes the next free number.
        self.assertEqual(staged_names('/job/input', wanted), ['x.fits', 'x_3.fits', 'X_4.FITS', 'x_2.fits'])
        self.assertEqual(staged_names('/job/input', wanted), staged_names('/job/input', wanted))

    def test_names_iraf_cannot_take_keep_the_alias(self):
        for name in ('한글 영상.fits', 'a b.fits', 'a[1].fits', 'a,b.fits', '@list.fits', 'home$x.fits', 'a%b.fits', 'a*.fits', '-x.fits'):
            self.assertFalse(iraf_safe(Path('/job/input') / name), name)
            self.assertEqual(staged_names('/job/input', [('/a/' + name, name, 's00000.fits')]), ['s00000.fits'])
        for name in ('alpM67_B30_1.fits', 'Dark30.fits', 'M67b.psf.1.fits', 'a-b+c.fit'):
            self.assertTrue(iraf_safe(Path('/job/input') / name), name)
        long = 'x' * MAX_PATH + '.fits'
        self.assertEqual(staged_names('/job/input', [('/a/' + long, long, 's00000.fits')]), ['s00000.fits'])

    def test_alias_and_real_name_do_not_collide(self):
        wanted = [('/a/한글.fits', '한글.fits', 's00000.fits'), ('/b/s00000.fits', 's00000.fits', 's00001.fits')]
        self.assertEqual(staged_names('/job/input', wanted), ['s00000.fits', 's00000_2.fits'])


class GenericStagingTests(unittest.TestCase):
    def test_lists_and_sources_use_staged_names(self):
        from giraf.generic_tasks.preparation import stage_inputs, prepare_parameters
        from giraf.task_discovery import file_hash
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            rows = []
            for i, (folder, name) in enumerate([('n1', 'Zero.fits'), ('n2', 'Zero.fits'), ('n1', 'raw 1.fits'), ('n1', 'M67b.psf.1')]):
                path = root / folder / name
                path.parent.mkdir(exist_ok=True)
                path.write_bytes(bytes([i]))
                rows.append(dict(id=str(i), path=str(path), sha256=file_hash(path), asset='image'))
            manifest = dict(definition=dict(schemaFiles={}, inputs=[dict(name='input')]),
                            rows=rows, inputs={'input': ['0', '1', '2', '3']}, parameters={})
            job = root / 'job'
            job.mkdir()
            aliases = stage_inputs(job, manifest)
            self.assertEqual(list(aliases.values()), ['input/Zero.fits', 'input/Zero_2.fits', 'input/s00002.fits', 'input/M67b.psf.1.fits'])
            params = prepare_parameters(job, manifest, aliases)
            self.assertEqual((job / params['input'][1:]).read_text().split(), list(aliases.values()))
            sources = json.loads((job / 'sources.json').read_text())
            self.assertEqual([(s['original'], s['alias']) for s in sources], [(r['path'], aliases[r['id']]) for r in rows])
            for row, alias in zip(rows, aliases.values()):
                self.assertEqual((job / alias).read_bytes(), Path(row['path']).read_bytes())


class TaskRunStagingTests(unittest.TestCase):
    def test_inputs_and_masks_keep_names_without_overwriting(self):
        from giraf.task_worker import TaskRun
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            for folder in ('n1', 'n2', 'masks'):
                (root / folder).mkdir()
            (root / 'masks/bad.pl').write_bytes(b'pl')
            fits.writeto(root / 'masks/bad.fits', np.zeros((2, 2), 'int16'))
            rows = []
            for i, (folder, mask) in enumerate([('n1', 'bad.fits'), ('n2', 'bad.pl')]):
                path = root / folder / 'Flat.fits'
                fits.writeto(path, np.full((2, 2), i, 'float32'), fits.Header({'BPM': str(root / 'masks' / mask)}))
                rows.append(dict(id=str(i), path=str(path), asset='image'))
            job = root / 'job'
            job.mkdir()
            atomic_json(job / 'manifest.json', dict(task='combine', rows=rows, inputs={'input': ['0', '1']},
                                                    parameters=dict(masktype='goodvalue'), ccdproc={}))
            run = TaskRun(job)
            run.stage_inputs()
            self.assertEqual(run.aliases, {'0': 'input/Flat.fits', '1': 'input/Flat_2.fits'})
            self.assertEqual([fits.getval(job / a, 'BPM') for a in run.aliases.values()], ['references/bad.pl', 'references/bad_2.pl'])
            self.assertEqual(run.mask_conversions, [('references/bad.fits', 'references/bad.pl')])
            self.assertEqual((job / 'references/bad_2.pl').read_bytes(), b'pl')
            sources = json.loads((job / 'sources.json').read_text())
            self.assertEqual([s['original'] for s in sources], [r['path'] for r in rows])


@requires_irafcl
class IRAFRecordsNamesTests(unittest.TestCase):
    """Real IRAF runs: provenance keywords name the inputs, not the run's copies."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name).resolve()
        self.rows = {}
        if 'iraf' not in os.environ:  # PyRAF finds IRAF through it
            os.environ['iraf'] = str(installed_root()) + '/'
            self.addCleanup(os.environ.pop, 'iraf')

    def frame(self, relative, value, kind, filter='B', exposure=30.):
        from giraf.server import register
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        fits.writeto(path, np.full((16, 20), value, dtype='float32'),
                     fits.Header({'IMAGETYP': kind, 'FILTER': filter, 'EXPTIME': exposure, 'DARKTIME': exposure}))
        row = register(path)
        self.rows[row['id']] = row
        return row['id']

    def execute(self, payload):
        from giraf.server import register
        from giraf.task_jobs import validate_task
        manifest = validate_task(dict(payload, workingDirectory=str(self.root)), self.rows.__getitem__)
        job = self.root / f'run{len(list(self.root.glob("run*")))}'
        job.mkdir()
        atomic_json(job / 'manifest.json', manifest)
        subprocess.run([sys.executable, '-m', 'giraf.task_worker', str(job)], cwd=job, capture_output=True, timeout=120,
                       env=dict(os.environ, PYTHONPATH=str(ROOT), PYRAF_NO_DISPLAY='1'))
        status = json.loads((job / 'status.json').read_text())
        self.assertEqual(status['state'], 'completed', (job / 'task.log').read_text() if (job / 'task.log').exists() else status)
        products = [p for p in json.loads((job / 'products.json').read_text()) if p['asset'] == 'image']
        for p in products:
            row = register(job / p['file'], p['label'], job.name, 'image')
            self.rows[row['id']] = row
            p['id'] = row['id']
        return job, products

    def test_combine_and_ccdproc_record_input_names(self):
        none = {k: 'no' for k in ('fixpix', 'overscan', 'trim', 'zerocor', 'darkcor', 'flatcor', 'illumcor', 'fringecor', 'readcor', 'scancor')}
        for backend in ('cl', 'pyraf'):
            with self.subTest(backend=backend):
                zeros = [self.frame(f'{backend}/{night}/bias.fits', 10, 'zero', exposure=0.) for night in ('n1', 'n2')]
                job, (zero,) = self.execute(dict(task='zerocombine', backend=backend, inputs={'input': zeros},
                                             parameters=dict(combine='average', reject='none'), ccdproc=none))
                self.assertEqual(sorted(p.name for p in (job / 'input').iterdir()), ['bias.fits', 'bias_2.fits'])
                darks = [self.frame(f'{backend}/dark{i}.fits', 40, 'dark') for i in (1, 2)]
                _, (dark,) = self.execute(dict(task='darkcombine', backend=backend, inputs={'input': darks, 'zero': [zero['id']]},
                                           parameters=dict(combine='average', reject='none', scale='none', process='yes'),
                                           ccdproc=dict(none, zerocor='yes')))
                self.assertTrue(fits.getheader(self.rows[dark['id']]['path'])['ZEROCOR'].endswith('is input/Zero.fits'))
                science = [self.frame(f'{backend}/M67_B30_{i}.fits', 100 + i, 'object') for i in (1, 2)]
                job, processed = self.execute(dict(task='ccdproc', backend=backend, inputs={'images': science, 'zero': [zero['id']], 'dark': [dark['id']]},
                                               parameters=dict(none, zerocor='yes', darkcor='yes'), outputs={'output': 'p'}))
                header = fits.getheader(job / processed[0]['file'])
                self.assertTrue(header['ZEROCOR'].endswith('is input/Zero.fits'), header['ZEROCOR'])
                self.assertIn('is input/Dark.fits', header['DARKCOR'])
                np.testing.assert_array_equal(fits.getdata(job / processed[0]['file']), 101 - 10 - 30)
                _, (combined,) = self.execute(dict(task='images.immatch.imcombine', backend=backend,
                                               inputs={'input': [p['id'] for p in processed]},
                                               parameters=dict(combine='average', reject='none'), outputs={'output': 'M67B'}))
                header = fits.getheader(self.rows[combined['id']]['path'])
                self.assertEqual([header['IMCMB001'], header['IMCMB002']], ['pM67_B30_1.fits', 'pM67_B30_2.fits'])


if __name__ == '__main__':
    unittest.main()
