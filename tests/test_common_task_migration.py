import unittest
import tempfile
import json
from itertools import product
from pathlib import Path
import numpy as np
from astropy.io import fits
from giraf.task_jobs import validate_task
from giraf.generic_tasks import GenericTaskRun
from giraf.task_catalog import TASKS
from giraf.task_schema import parameter_profile

class CommonTaskMigrationTests(unittest.TestCase):
    def test_existing_ids_use_discovered_schemas(self):
        for name in ('ccdproc', 'imexamine'):
            s = TASKS[name]
            self.assertEqual(s['adapter'], 'generic')
            self.assertEqual(s['taskName'], name)
            self.assertTrue(s['schemaFiles'])
        self.assertTrue({'zero','dark','flat','illum','fringe'} <= {s['name'] for s in TASKS['ccdproc']['inputs']})
        self.assertTrue({'imagecur','graphcur'} <= {s['name'] for s in TASKS['imexamine']['inputs']})

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            frame = root / 'image.fits'
            fits.writeto(frame, np.ones((32,32), dtype=np.float32))
            row = dict(id='image', name=frame.name, label=frame.name, path=str(frame), asset='image')
            for name, backend in product(('ccdproc', 'imexamine'), ('cl', 'pyraf')):
                params = {p['name']:'no' for p in TASKS[name]['parameters'] if p['type']=='b'}
                if 'ccdtype' in {p['name'] for p in TASKS[name]['parameters']}: params.update(ccdtype='', trim='yes', trimsec='[1:30,1:30]')
                inputs = {'images':['image']} if name=='ccdproc' else {'input':['image'],'image':['image']}
                payload = dict(task=name, backend=backend, inputs=inputs, parameters=params,
                               outputs={'output':'processed_' if name=='ccdproc' else ''},
                               cursorCommands={} if name=='ccdproc' else {'imagecur':'16 16 1 m\nq\n'})
                m = validate_task(payload, lambda key: row)
                self.assertEqual(m['adapter'], 'generic')
                job = root / (name + '-' + backend)
                job.mkdir()
                (job/'manifest.json').write_text(json.dumps(m))
                run = GenericTaskRun(job)
                run.execute()
                self.assertEqual(json.loads((job/'status.json').read_text())['state'], 'completed', name + ': ' + (job/'task.log').read_text() + (job/'outcomes.json').read_text() + (job/'commands.cl').read_text())

    def test_modified_image_nouns_are_ports_without_task_names(self):
        p = dict(name='reference_data', type='s', mode='h', default='', prompt='Zero level calibration image')
        s = parameter_profile([p])['profile']['inputs']
        self.assertEqual([(i['name'], i['kind']) for i in s], [('reference_data','image')])
        self.assertEqual(parameter_profile([dict(p, prompt='CCD image type to correct')])['profile']['inputs'], [])
