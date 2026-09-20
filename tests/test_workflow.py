import unittest
from copy import deepcopy
from giraf.workflow import execute_workflow, workflow_order


def graph():
    return {'nodes': [{'id': x, 'label': x, 'payload': {'task': 'fake', 'inputs': {}, 'parameters': {}}} for x in ['c', 'a', 'b']],
            'links': [{'source': 'a', 'target': 'c', 'role': 'zero', 'kind': 'image', 'multiple': False}, {'source': 'b', 'target': 'c', 'role': 'images', 'kind': 'image', 'multiple': True}]}

class WorkflowTests(unittest.TestCase):
    def test_topology_and_cycle_and_missing_source(self):
        g=graph(); self.assertEqual(workflow_order(g), ['a','b','c'])
        g['links'].append(dict(source='c',target='a',role='input',kind='image',multiple=True))
        with self.assertRaisesRegex(ValueError,'순환'): workflow_order(g)
        g=graph(); g['links'][0]['source']='missing'
        with self.assertRaisesRegex(ValueError,'없는 작업'): workflow_order(g)
    def test_current_run_products_flow_without_mutating_graph(self):
        g=graph(); before=deepcopy(g); calls=[]
        def run(node,payload):
            calls.append((node['id'],deepcopy(payload)))
            return {'id':node['id']+'-new','state':'completed','products':[{'id':node['id']+'-file','asset':'image'}]}
        state=execute_workflow(g,run,lambda:False,lambda s:None)
        self.assertEqual(state['state'],'completed')
        self.assertEqual(calls[-1][1]['inputs'], {'zero':['a-file'],'images':['b-file']})
        self.assertEqual(g,before)
        # The same result-forwarding contract against the installed IRAF engine.
        import os
        if os.environ.get('GIRAF_IRAF_CHECK'):
            import tempfile, json
            from pathlib import Path
            import numpy as np
            from astropy.io import fits
            from giraf import server
            from giraf.task_jobs import validate_task
            from giraf.task_worker import TaskRun
            from giraf.jobs import atomic_json
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp); registered={}; sequence=[]
                for name,value,kind in [('bias',10,'zero'),('science',100,'object')]:
                    path=root/(name+'.fits')
                    fits.writeto(path,np.full((12,16),value,dtype='float32'),fits.Header(dict(IMAGETYP=kind,EXPTIME=10,DARKTIME=10,FILTER='R')))
                    row=server.register(path);registered[name]=row
                off={k:'no' for k in ('fixpix','overscan','trim','zerocor','darkcor','flatcor','illumcor','fringecor','readcor','scancor')}
                nodes=[{'id':'bias','label':'Bias','payload':dict(task='zerocombine',inputs={'input':[registered['bias']['id']]},parameters={'ccdtype':'','process':'no','reject':'none'},ccdproc=off,output={'name':'Bias.fits'})},
                       {'id':'science','label':'Science','payload':dict(task='ccdproc',inputs={'images':[registered['science']['id']]},parameters=dict(off,ccdtype='',zerocor='yes'),ccdproc=off,output={'name':'p'})}]
                def actual(n,p):
                    p['workingDirectory']=tmp
                    manifest=validate_task(p,lambda id:server.registry[id]);manifest['fileAuthorized']=True
                    job=root/('job'+str(len(sequence)));job.mkdir();atomic_json(job/'manifest.json',manifest)
                    TaskRun(job).execute()
                    result=server.job_info(job)
                    if result['state']=='failed': print((job/'task.log').read_text())
                    sequence.append(result)
                    return result
                finished=execute_workflow({'nodes':nodes,'links':[dict(source='bias',target='science',role='zero',kind='image',multiple=False)]},actual,lambda:False,lambda s:None)
                self.assertEqual(finished['state'],'completed',finished)
                image=next(p for p in sequence[-1]['products'] if p['asset']=='image')
                self.assertAlmostEqual(float(fits.getdata(image['path']).mean()),90)
    def test_failure_and_missing_outputs_stop_dependents(self):
        for result in [{'state':'failed','products':[]},{'state':'skipped','products':[]}]:
            calls=[]
            def run(n,p): calls.append(n['id']); return dict(id='run',**result)
            state=execute_workflow(graph(),run,lambda:False,lambda s:None)
            self.assertNotIn('c',calls); self.assertEqual(state['state'],'failed')
            self.assertTrue(state['message'])
    def test_single_input_does_not_silently_pick_one_of_many_products(self):
        def run(n,p): return {'id':'r','state':'completed','products':[{'id':'x','asset':'image'},{'id':'y','asset':'image'}]}
        state=execute_workflow(graph(),run,lambda:False,lambda s:None)
        self.assertEqual(state['state'],'failed'); self.assertIn('한 개',state['message'])
    def test_cancellation_prevents_launch_and_keeps_finished_jobs(self):
        calls=[]
        def run(n,p): calls.append(n['id']); return {'id':'r','state':'completed','products':[{'id':'x','asset':'image'}]}
        state=execute_workflow(graph(),run,lambda:bool(calls),lambda s:None)
        self.assertEqual(calls,['a']); self.assertEqual(state['state'],'cancelled'); self.assertEqual(len(state['jobs']),1)
    def test_exception_becomes_actionable_failure(self):
        def run(n,p): raise ValueError('입력 파일 없음')
        state=execute_workflow(graph(),run,lambda:False,lambda s:None)
        self.assertIn('a',state['message']); self.assertIn('입력 파일 없음',state['message'])
    def test_empty_workflow_rejected(self):
        with self.assertRaises(ValueError): workflow_order({'nodes':[],'links':[]})

if __name__=='__main__': unittest.main()

class ManagerTests(unittest.TestCase):
    def test_confirmation_and_server_owned_progress(self):
        import tempfile,time
        from pathlib import Path
        from giraf.workflow import WorkflowManager
        launched=[]
        def prepare(p):return dict(p,filePlan={'destructive':True,'token':'token','targets':[{'path':'/file'}]})
        def launch(m):launched.append(m);return {'id':'job','state':'completed','products':[]}
        with tempfile.TemporaryDirectory() as tmp:
            manager=WorkflowManager(Path(tmp),prepare,launch,lambda id:{},lambda id:None)
            g={'nodes':[graph()['nodes'][0]],'links':[]}
            manager.start(g)
            for _ in range(200):
                if manager.current()['state']=='confirmation':break
                time.sleep(.005)
            self.assertEqual(manager.current()['state'],'confirmation');self.assertEqual(launched,[])
            with self.assertRaises(ValueError):manager.confirm('wrong')
            manager.confirm('token');manager.thread.join(2)
            self.assertEqual(manager.current()['state'],'completed');self.assertTrue(launched[0]['fileAuthorized'])
            self.assertTrue((Path(tmp)/'current.json').exists())
    def test_duplicate_start_rejected_and_cancel_releases_confirmation(self):
        import tempfile,time
        from pathlib import Path
        from giraf.workflow import WorkflowManager
        with tempfile.TemporaryDirectory() as tmp:
            manager=WorkflowManager(Path(tmp),lambda p:dict(p,filePlan={'destructive':True,'token':'t','targets':[]}),lambda m:self.fail('must not launch'),lambda id:{},lambda id:None)
            g={'nodes':[graph()['nodes'][0]],'links':[]};manager.start(g)
            with self.assertRaises(ValueError):manager.start(g)
            manager.cancel();manager.thread.join(2)
            self.assertEqual(manager.current()['state'],'cancelled')

    def test_launches_share_persisted_execution_identity_and_new_click_gets_new_identity(self):
        import tempfile
        from giraf.workflow import WorkflowManager
        launched = []
        def launch(manifest):
            launched.append(manifest.copy())
            return {'id': str(len(launched)), 'state': 'completed', 'products': []}
        with tempfile.TemporaryDirectory() as tmp:
            manager = WorkflowManager(tmp, lambda p: dict(p, filePlan={'destructive': False}), launch, lambda id: {}, lambda id: None)
            g = {'nodes': [{'id': 'a', 'label': 'a', 'payload': {}}, {'id': 'b', 'label': 'b', 'payload': {}}], 'links': []}
            manager.start(g)
            manager.thread.join(2)
            first_id = manager.current()['id']
            self.assertEqual([m['workflowId'] for m in launched], [first_id, first_id])
            self.assertEqual([m['workflowStep'] for m in launched], [0, 1])
            manager.start(g)
            manager.thread.join(2)
            self.assertNotEqual(launched[2]['workflowId'], first_id)
            self.assertEqual(launched[2]['workflowId'], launched[3]['workflowId'])

    def test_execution_membership_survives_next_start_and_restart_for_legacy_jobs(self):
        import json, tempfile
        from pathlib import Path
        from giraf.workflow import WorkflowManager
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'current.json').write_text(json.dumps({'id':'old', 'state':'completed', 'jobs':[{'id':'a'}, {'id':'b'}], 'currentJob':None}))
            make = lambda: WorkflowManager(root, lambda p: dict(p,filePlan={'destructive':False}), lambda m: {'id':'new','state':'completed','products':[]}, lambda id: {}, lambda id: None)
            manager = make()
            self.assertEqual(manager.membership('a'), {'id':'old','step':0})
            self.assertEqual(manager.current()['jobs'][1]['execution'], {'id':'old','step':1})
            manager.start({'nodes':[{'id':'node','label':'node','payload':{}}], 'links':[]})
            manager.thread.join(2)
            restored = make()
            self.assertEqual(restored.membership('b'), {'id':'old','step':1})
            self.assertEqual(restored.membership('new')['id'], manager.current()['id'])
