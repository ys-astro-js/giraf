"""GUI image-list contracts, written before implementation."""
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
from astropy.io import fits
from giraf.task_catalog import TASKS
from giraf.task_jobs import validate_task
from giraf.generic_tasks import validate_generic, GenericTaskRun
from giraf.task_worker import TaskRun
from giraf.workflow import execute_workflow
from giraf.model import inspect_file

class ImageListTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.rows = {}
        for name, value in [('a',1),('b',3),('c',5),('d',7)]:
            p=self.root/(name+'.fits')
            fits.writeto(p,np.full((8,8),value,dtype=np.float32))
            self.rows[name]=dict(inspect_file(p),id=name,label=p.name,asset='image')
        for name, content in [('first','a.fits\nb.fits\n'),('second','c.fits\nd.fits\n')]:
            self.list_file(name,content)
    def list_file(self,name,content):
        p=self.root/(name+'.list');p.write_text(content)
        self.rows[name]=dict(id=name,name=p.name,label=p.name,path=str(p),asset='image-list')
        return p
    def payload(self, ids):
        return dict(task='zerocombine',backend='cl',workingDirectory=str(self.root),inputs={'input':ids},
                    parameters={'ccdtype':'','process':'no','combine':'average','reject':'none'},output={'name':'Zero.fits'})
    def test_multiple_lists_expand_in_order_in_legacy_and_generic_paths(self):
        from giraf.image_lists import expand_image_selection
        rows, lists = expand_image_selection({'kind':'image','multiple':True},['first','second','a'],self.rows.__getitem__,self.root)
        self.assertEqual([r['name'] for r in rows],['a.fits','b.fits','c.fits','d.fits','a.fits'])
        self.assertEqual(len(lists),2)
        m=validate_task(self.payload(['first','second']),self.rows.__getitem__)
        self.assertEqual(len(m['inputs']['input']),4)
        self.assertEqual(len(m['inputLists']),2)
        self.assertEqual(m['inputSelections']['input'],['first','second'])
        self.assertEqual(m['inputLists'][0]['sha256'],lists[0]['sha256'])
        generic=dict(TASKS['workflow.image_list'],name='extension.any_task',executor=None)
        g=validate_generic(generic,dict(inputs={'input':['first','second']},outputs={'output':'new.list'}),self.rows.__getitem__)
        self.assertEqual(len(g['inputs']['input']),4)
        with self.assertRaises(ValueError):
            expand_image_selection({'kind':'image','multiple':False},['first'],self.rows.__getitem__,self.root)
    def test_relative_nested_lists_missing_entries_and_cycles(self):
        from giraf.image_lists import expand_image_selection
        sub=self.root/'sub';sub.mkdir()
        (sub/'nested.list').write_text('../a.fits\n../b.fits[1:4,1:4]\n')
        self.list_file('outer','@sub/nested.list\n')
        rows,lists=expand_image_selection({'kind':'image','multiple':True},['outer'],self.rows.__getitem__,self.root)
        self.assertEqual([r['section'] for r in rows],['','[1:4,1:4]'])
        self.assertEqual(len(lists),2)
        self.list_file('outer','@outer.list\n')
        with self.assertRaisesRegex(ValueError,'순환'):
            expand_image_selection({'kind':'image','multiple':True},['outer'],self.rows.__getitem__,self.root)
        self.list_file('outer','missing.fits\n')
        with self.assertRaisesRegex(ValueError,'missing.fits'):
            expand_image_selection({'kind':'image','multiple':True},['outer'],self.rows.__getitem__,self.root)
        self.list_file('outer','\n# empty\n')
        with self.assertRaises(ValueError):
            expand_image_selection({'kind':'image','multiple':True},['outer'],self.rows.__getitem__,self.root)
        self.rows['text']=dict(self.rows['first'],id='text',asset='text')
        with self.assertRaises(ValueError): validate_task(self.payload(['text']),self.rows.__getitem__)
    def test_input_lists_are_frozen_with_the_execution_plan(self):
        m=validate_task(self.payload(['first']),self.rows.__getitem__)
        job=self.root/'frozen';job.mkdir();(job/'manifest.json').write_text(json.dumps(m))
        (self.root/'first.list').write_text('d.fits\n')
        with self.assertRaisesRegex(ValueError,'변경'):
            TaskRun(job).prepare()
    def test_list_nodes_feed_multiple_lists_to_an_image_node_and_execute(self):
        creator=TASKS['workflow.image_list']
        self.assertEqual(creator['outputs'][0]['kind'],'image-list')
        self.assertEqual(creator['executor'],'image-list')
        seen=[]
        def run(node,payload):
            payload.update(workingDirectory=str(self.root),backend='cl')
            m=validate_task(payload,self.rows.__getitem__)
            job=self.root/node['id'];job.mkdir();(job/'manifest.json').write_text(json.dumps(m))
            (GenericTaskRun(job) if m.get('adapter')=='generic' else TaskRun(job)).execute()
            state=json.loads((job/'status.json').read_text())
            self.assertEqual(state['state'],'completed',state)
            products=[]
            for p in json.loads((job/'products.json').read_text()):
                id=node['id']+'-'+str(len(products))
                row=dict(p,id=id,path=str(job/p['file']),name=p['label'])
                self.rows[id]=row;products.append(row)
            seen.append((m,products))
            return dict(id=node['id'],state='completed',products=products)
        graph=dict(nodes=[
            dict(id='list1',label='list1',payload=dict(task='workflow.image_list',inputs={'input':['a','b']},outputs={'output':'Bias1.list'})),
            dict(id='list2',label='list2',payload=dict(task='workflow.image_list',inputs={'input':['c','d']},outputs={'output':'Bias2.list'})),
            dict(id='combine',label='combine',payload=self.payload(['a']))],
            links=[dict(source=n,target='combine',role='input',kind='image',multiple=True) for n in ('list1','list2')])
        original=json.loads(json.dumps(graph))
        state=execute_workflow(graph,run,lambda:False,lambda s:None)
        self.assertEqual(state['state'],'completed',state['message'])
        self.assertEqual(graph,original)
        self.assertEqual(len(seen[-1][0]['inputs']['input']),5)
        image=next(p for p in seen[-1][1] if p['asset']=='image')
        self.assertTrue(np.allclose(fits.getdata(image['path']),3.4))
        list_product=seen[0][1][0]
        content=Path(list_product['path']).read_text()
        self.assertIn(str(self.root/'a.fits'),content)
        self.assertIn(str(self.root/'b.fits'),content)
    def test_registration_exposes_lists_in_workspace_and_text_preview(self):
        from giraf import server
        from unittest.mock import patch
        with patch.object(server,'workspace',{'folder':str(self.root),'overrides':{},'sets':[]}):
            row=server.register(self.root/'first.list')
            self.assertEqual(row['asset'],'image-list')
            self.assertTrue(any(r['id']==row['id'] for r in server.files()))
