import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from astropy.io import fits
import numpy as np
from giraf import server


async def request(method, action, payload=None, query='', origin=None):
    sent=[]
    delivered=False
    async def receive():
        nonlocal delivered
        if delivered:
            return {'type':'http.disconnect'}
        delivered=True
        return {'type':'http.request','body':json.dumps(payload or {}).encode(),'more_body':False}
    async def send(message): sent.append(message)
    headers=[(b'host',b'testserver')]
    if origin: headers.append((b'origin',origin.encode()))
    scope={'type':'http','asgi':{'version':'3.0'},'http_version':'1.1','method':method,'scheme':'http',
           'path':'/api/'+action,'raw_path':('/api/'+action).encode(),'query_string':query.encode(),
           'root_path':'','headers':headers,'server':('testserver',80),'client':('testclient',1)}
    await server.app(scope,receive,send)
    status=next(m['status'] for m in sent if m['type']=='http.response.start')
    body=b''.join(m.get('body',b'') for m in sent if m['type']=='http.response.body')
    return status,json.loads(body) if body else None


class WorkspaceTests(unittest.TestCase):
    def test_metadata_and_pixel_coordinates(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            f=root/'image.fits'
            fits.writeto(f,np.arange(12,dtype='float32').reshape(3,4),fits.Header({'IMAGETYP':'LIGHT','EXPTIME':10}))
            state={'folder':str(root),'sets':[],'overrides':{}}
            with patch.object(server,'STATE',root/'workspace.json'),patch.object(server,'workspace',state),patch.object(server,'registry',{}):
                frame=server.register(f)
                code,data=asyncio.run(request('GET','pixel',query=f"id={frame['id']}&x=1&y=1"))
                self.assertEqual((code,data['value']),(200,0.))
                self.assertEqual(data['row'],[0.,1.,2.,3.])
                code,_=asyncio.run(request('POST','metadata',{'ids':[frame['id']],'changes':{'kind':'flat','filter':'B'}}))
                self.assertEqual(code,200)
                self.assertEqual(server.register(f)['group'],'flat')
                self.assertEqual(fits.getheader(f)['IMAGETYP'],'LIGHT')
                code,_=asyncio.run(request('POST','save-set',{'ids':[frame['id']],'name':'My input'}))
                self.assertEqual(code,200)
                self.assertEqual(json.loads((root/'workspace.json').read_text())['sets'][0]['name'],'My input')
                code,_=asyncio.run(request('GET','info',query='id=notregistered'))
                self.assertEqual(code,400)

    def test_job_creation_time_is_stable_and_orders_runs_within_one_second(self):
        import os
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            jobs = []
            for name, timestamp in [('20260925-120000-ffffff', 1000000100), ('20260925-120000-000000', 1000000200)]:
                job = root / name
                job.mkdir()
                manifest = job / 'manifest.json'
                manifest.write_text(json.dumps({'rows': [], 'settings': {}}))
                os.utime(manifest, ns=(timestamp, timestamp))
                (job / 'status.json').write_text(json.dumps({'state': 'failed'}))
                jobs.append(job)
            with patch.object(server.workflow_manager, 'membership', return_value=None):
                first = server.job_info(jobs[0])
                second = server.job_info(jobs[1])
                self.assertLess(first['createdAt'], second['createdAt'])
                (jobs[0] / 'status.json').write_text(json.dumps({'state': 'completed'}))
                self.assertEqual(first['createdAt'], server.job_info(jobs[0])['createdAt'])
                process = jobs[0] / 'process.json'
                process.write_text('{}')
                stable = server.job_info(jobs[0])['createdAt']
                os.utime(jobs[0] / 'manifest.json', ns=(2000000000, 2000000000))
                self.assertEqual(stable, server.job_info(jobs[0])['createdAt'])
            from giraf.workflow import WorkflowManager
            workflow_root = root / 'workflow'
            workflow_root.mkdir()
            (workflow_root / 'current.json').write_text(json.dumps({'id': 'w', 'state': 'failed', 'jobs': []}))
            manager = WorkflowManager(workflow_root, None, None, None, None)
            self.assertGreater(manager.current()['updatedAt'], 0)
            self.assertEqual(manager.current()['updatedAt'], manager.current()['updatedAt'])

    def test_cross_origin_mutation_rejected(self):
        code,_=asyncio.run(request('POST','folder',{'path':'/'},origin='https://unrelated.example'))
        self.assertEqual(code,403)
