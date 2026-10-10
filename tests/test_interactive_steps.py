"""Interactive steps in workflow runs, and tasks that pass their edited inputs on."""
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

import numpy as np
from astropy.io import fits

from giraf.task_capabilities import installed_root


class SchemaRules(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        pkg = self.root / 'pkg' / 'demo'
        pkg.mkdir(parents=True)
        (pkg / 'demo.cl').write_text('package demo\ntask edit = "demo$x.e"\ntask pick = "demo$x.e"\ntask fit = "demo$x.e"\nclbye()\n')
        (pkg / 'edit.par').write_text('images,s,a,"",,,Images to edit\nfield,s,h,"",,,Keyword\n'
                                      'verify,b,h,yes,,,Verify\nupdate,b,h,yes,,,Update image header\nmode,s,h,ql\n')
        (pkg / 'pick.par').write_text('image,f,a,"",,,Image\nicommands,*imcur,h,"",,,Image cursor: [x y wcs] key [cmd]\nmode,s,h,ql\n')
        (pkg / 'fit.par').write_text('image,f,a,"",,,Image\nicommands,*imcur,h,"",,,Image cursor: [x y wcs] key [cmd]\n'
                                     'interactive,b,h,no,,,Interactive mode\nmode,s,h,ql\n')
        self.schemas = self.root / 'schemas'
        self.schemas.mkdir()
        image = self.root / 'a.fits'
        fits.writeto(image, np.zeros((4, 4), 'float32'))
        self.row = dict(id='a', name='a.fits', label='a.fits', path=str(image), asset='image')

    def write(self, task, data):
        (self.schemas / f'{task}.json').write_text(json.dumps({'version': 2, 'task': f'demo.{task}', **data}))

    def spec(self, task):
        from giraf.task_discovery import discover
        return discover(self.root, schema_directories=[('giraf', self.schemas)])['tasks'][f'demo.{task}']

    def test_a_pass_output_hands_on_edited_inputs_under_their_names(self):
        from giraf.generic_tasks import validate_generic, preview_generic
        with self.assertRaisesRegex(ValueError, 'update'):
            validate_generic(self.spec('edit'), dict(inputs={'images': ['a']}, parameters={'update': 'yes'}), lambda _: self.row)
        self.write('edit', {'outputs': {'result': {'kind': 'image', 'mode': 'pass', 'from': 'images', 'label': '결과'}}})
        spec = self.spec('edit')
        self.assertTrue(spec['runnable'], spec['reason'])
        self.assertEqual([o['name'] for o in spec['outputs']], ['result', '$stdout'])
        m = validate_generic(spec, dict(inputs={'images': ['a']}, parameters={'update': 'yes'}), lambda _: self.row)
        self.assertEqual([(p.get('role'), p['output']) for p in preview_generic(m)], [('result', 'a.fits'), ('$stdout', 'edit.txt')])
        # Verifying each edit still asks a question the run cannot answer.
        with self.assertRaisesRegex(ValueError, 'verify'):
            validate_generic(spec, dict(inputs={'images': ['a']}, parameters={'verify': 'yes'}), lambda _: self.row)

    def test_a_pass_output_cannot_take_an_iraf_parameter_name(self):
        self.write('edit', {'outputs': {'field': {'kind': 'image', 'mode': 'pass', 'from': 'images'}}})
        spec = self.spec('edit')
        self.assertIn('field', {i['name'] for i in spec['inputs']} | {p['name'] for p in spec['parameters']})
        self.assertTrue(any('pass' in i['message'] for i in spec['schemaIssues']))

    def test_a_cursor_component_makes_the_run_read_the_cursor(self):
        from giraf.generic_tasks import validate_generic
        self.assertFalse(validate_generic(self.spec('pick'), dict(inputs={'image': ['a']}), lambda _: self.row).get('interactive'))
        self.write('pick', {'components': [{'type': 'cursor', 'image': {'click': 'a', 'finish': {'label': '끝내기', 'keys': ['q']}}}]})
        spec = self.spec('pick')
        m = validate_generic(spec, dict(inputs={'image': ['a']}), lambda _: self.row)
        self.assertTrue(m['interactive'])
        self.assertEqual(m['cursorImage'], 'a')
        # Recorded commands replay instead.
        replay = validate_generic(spec, dict(inputs={'image': ['a']}, cursorCommands={'icommands': '1 1 1 a\n'}), lambda _: self.row)
        self.assertFalse(replay.get('interactive'))
        # A task with IRAF's interactive switch keeps deciding by it.
        self.write('fit', {'components': [{'type': 'cursor', 'image': {'click': 'a'}}]})
        self.assertFalse(validate_generic(self.spec('fit'), dict(inputs={'image': ['a']}), lambda _: self.row).get('interactive'))
        self.assertTrue(validate_generic(self.spec('fit'), dict(inputs={'image': ['a']}, parameters={'interactive': 'yes'}), lambda _: self.row)['interactive'])


class Groups(unittest.TestCase):
    def test_jobs_of_a_split_task_learn_their_group(self):
        from giraf.workflow import execute_workflow
        seen = []

        def run(node, payload):
            seen.append(node.get('group'))
            return dict(id=node['id'], state='completed', products=[])
        graph = dict(nodes=[dict(id='t', label='daoedit', payload={'inputs': {'image': ['M67B.fits', 'M67V.fits']},
                                                                  'split': {'input': 'image', 'by': [{'each': True}]}})], links=[])
        state = execute_workflow(graph, run, lambda: False, lambda s: None, str, lambda id: {'label': id})
        self.assertEqual(state['state'], 'completed', state['message'])
        self.assertEqual(seen, [dict(id='M67B', name='M67B'), dict(id='M67V', name='M67V')])


class Measuring(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.runs = Path(self.tmp.name) / 'runs'
        self.runs.mkdir()

    def finished(self, manifest, answers):
        job = self.runs / 'first'
        (job / 'output').mkdir(parents=True)
        (job / 'output' / 'o.txt').write_text('# XCENTER\n1.0\n')
        (job / 'products').mkdir()
        (job / 'products' / 'o.txt').write_text('# XCENTER\n1.0\n')
        (job / 'products.json').write_text(json.dumps([dict(file='products/o.txt', label='daoedit.txt', asset='text', role='$stdout', sourceInput='old')]))
        (job / 'status.json').write_text(json.dumps(dict(state='completed')))
        (job / 'manifest.json').write_text(json.dumps(dict(manifest, rows=[dict(id='old', sha256='h1', label='M67B.fits')])))
        (job / 'interaction-history.jsonl').write_text(''.join(json.dumps(dict(kind=k, response=r)) + '\n' for k, r in answers))
        return job

    def test_a_group_reuses_its_measurement_while_the_image_is_unchanged(self):
        from giraf.measurements import Measurements
        store = Measurements(Path(self.tmp.name) / 'm.json', self.runs, lambda job: dict(id=job.name, state='completed'))
        manifest = dict(instanceId='node', group=dict(id='B', name='B'), nodeLabel='daoedit', inputs={'image': ['new']},
                        rows=[dict(id='new', sha256='h1', label='M67B.fits')], cursorImage='new',
                        cursor={'image': {'click': 'a', 'count': '측정한 별 {n}개'}}, definition=dict(taskName='daoedit'))
        self.finished(manifest, [('imcur', '10 10 1 a'), ('imcur', '20 20 1 r'), ('imcur', '30 30 1 a'), ('imcur', '0 0 1 q')])
        self.assertIsNone(store.reuse(manifest))
        store.remember(manifest, 'first')
        [record] = store.list('node')
        self.assertEqual((record['round'], record['count'], record['label']), ('B', 2, 'M67B.fits'))
        job = store.reuse(manifest)
        folder = self.runs / job['id']
        self.assertTrue((folder / 'task.log').read_text().startswith('daoedit B 지난 측정 사용\nM67B.fits 측정한 별 2개 '))
        products = json.loads((folder / 'products.json').read_text())
        self.assertEqual(products[0]['sourceInput'], 'new')
        self.assertEqual(products[-1]['role'], '$log')
        # Another image, or another group, measures again; clearing asks again.
        self.assertIsNone(store.reuse(dict(manifest, rows=[dict(id='new', sha256='h2')])))
        self.assertIsNone(store.reuse(dict(manifest, group=dict(id='V', name='V'))))
        store.clear('node', ['B'])
        self.assertIsNone(store.reuse(manifest))


def star_image(path, stars):
    y, x = np.mgrid[:128, :128]
    image = 100 + sum(a * np.exp(-((x-cx)**2+(y-cy)**2)/(2*s*s)) for a, cx, cy, s in stars)
    fits.writeto(path, image.astype('float32'))


@unittest.skipUnless(installed_root(), 'IRAF required')
class RealIraf(unittest.TestCase):
    def test_daoedit_measures_every_star_in_one_interactive_run(self):
        from giraf.generic_tasks import GenericTaskRun, validate_generic
        from giraf.jobs import atomic_json
        from giraf.task_discovery import discover
        from giraf.values import task_value
        spec = discover()['tasks']['noao.digiphot.daophot.daoedit']
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            stars = [(5000, 30.25, 40.75, 1.5), (3000, 90.5, 30.5, 2.0)]
            star_image(root / 'star.fits', stars)
            row = dict(id='star', name='star.fits', label='star.fits', path=str(root / 'star.fits'), asset='image')
            m = validate_generic(spec, dict(backend='cl', inputs={'image': ['star']}), lambda _: row)
            self.assertTrue(m['interactive'])
            job = root / 'job'
            job.mkdir()
            (job / 'manifest.json').write_text(json.dumps(m))
            worker = threading.Thread(target=lambda: GenericTaskRun(job).execute())
            worker.start()
            answers = [f'{round(cx) + 1} {round(cy) + 1} 1 a' for _, cx, cy, _ in stars] + m['cursor']['image']['finish']['keys']
            answered, deadline = set(), time.time() + 60
            while worker.is_alive() and time.time() < deadline:
                request = job / 'interaction.json'
                if request.exists():
                    q = json.loads(request.read_text())
                    if q['state'] == 'waiting' and q['id'] not in answered:
                        answered.add(q['id'])
                        value = answers.pop(0)
                        (job / 'responses').mkdir(exist_ok=True)
                        atomic_json(job / 'responses' / f"{q['id']}.json", {'value': value if ' ' in value else f'0 0 1 {value}'})
                time.sleep(.05)
            worker.join(5)
            self.assertEqual(json.loads((job / 'status.json').read_text())['state'], 'completed', (job / 'task.log').read_text())
            products = [dict(p, path=str(job / p['file'])) for p in json.loads((job / 'products.json').read_text())]
            fwhm = task_value(dict(state='completed', manifest=m, products=products), 'fwhm', lambda _: None)
            self.assertEqual(len(fwhm['values']), 2)
            from giraf.measurements import cursor_count
            self.assertEqual(cursor_count(job, m), 2)

    def test_hedit_passes_the_edited_copy_under_the_same_name(self):
        from giraf.generic_tasks import GenericTaskRun, validate_generic
        from giraf.task_discovery import discover
        spec = discover()['tasks']['images.imutil.hedit']
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / 'M67B.fits'
            fits.writeto(path, np.zeros((8, 8), 'float32'))
            original = path.read_bytes()
            row = dict(id='m', name=path.name, label=path.name, path=str(path), asset='image')
            m = validate_generic(spec, dict(backend='cl', inputs={'images': ['m']},
                                            parameters={'fields': 'RDNOISE', 'value': '27.39', 'add': 'yes'}), lambda _: row)
            job = root / 'job'
            job.mkdir()
            (job / 'manifest.json').write_text(json.dumps(m))
            GenericTaskRun(job).execute()
            self.assertEqual(json.loads((job / 'status.json').read_text())['state'], 'completed', (job / 'task.log').read_text())
            product = next(p for p in json.loads((job / 'products.json').read_text()) if p['role'] == 'result')
            self.assertEqual(product['label'], 'M67B.fits')
            self.assertEqual(fits.getheader(job / product['file'])['RDNOISE'], 27.39)
            self.assertEqual(json.loads((job / 'header-diff.json').read_text()),
                             [dict(source='m', label='M67B.fits', key='RDNOISE', before=None, after='27.39')])
            self.assertEqual(path.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
