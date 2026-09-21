"""Automatic IRAF I/O schemas and connected execution (specified before code)."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import numpy as np
from astropy.io import fits
from giraf.task_capabilities import installed_root

class AutomaticSchemaTests(unittest.TestCase):
    def test_new_package_gets_file_ports_without_descriptor_and_keeps_nonfile_parameters(self):
        from giraf.task_discovery import discover
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); pkg=root/'pkg/demo'; pkg.mkdir(parents=True)
            (pkg/'demo.cl').write_text('package demo\ntask shrink = "demo$x.e"\nclbye()\n')
            (pkg/'shrink.par').write_text('input,s,a,"",,,Input images\noutput,s,a,"",,,Output images\ntitle,s,h,"",,,Title of output image\nfactor,i,h,2,1,,Factor\n')
            (pkg/'t_shrink.x').write_text('procedure t_shrink()\nbegin\ncall clgstr ("input", a, 100)\ncall clgstr ("output", b, 100)\nl1 = imtopen(a)\nl2 = imtopen(b)\nwhile (imtgetim(l1, x, 100) != EOF && imtgetim(l2, y, 100) != EOF) {\ni = immap(x, READ_ONLY, 0)\no = immap(y, NEW_COPY, i)\n}\nend\n')
            s=discover(root)['tasks']['demo.shrink']
            self.assertTrue(s['runnable'],s['reason'])
            self.assertEqual([(p['name'],p['kind'],p['multiple']) for p in s['inputs']],[('input','image',True)])
            self.assertEqual([(p['name'],p['kind'],p['mode']) for p in s['outputs']],[('output','image','each')])
            self.assertEqual({p['name'] for p in s['parameters']},{'title','factor'})
            self.assertEqual(s['schemaSource'],'iraf')
            self.assertIn('immap',str(s['ioEvidence']))

    def test_source_changes_invalidate_contract_and_nonfile_strings_stay_parameters(self):
        from giraf.task_schema import infer_profile
        def par(name):return dict(name=name,prompt='Misleading output image',default='',type='s',mode='h',choices=[],min='',max='')
        source='procedure t_measure()\nbegin\ncall clgstr ("data", a, 100)\ncall clgstr ("out", b, 100)\ni = immap(a, READ_ONLY, 0)\no = immap(b, NEW_COPY, i)\nend'
        result=infer_profile([par('title'),par('data'),par('out')],source)
        self.assertEqual([p['name'] for p in result['profile']['inputs']],['data'])
        self.assertEqual([p['name'] for p in result['profile']['outputs']],['out'])
        self.assertEqual(result['profile']['outputs'][0]['mode'],'single')
        self.assertFalse(infer_profile([par('custom')],'')['complete'])

@unittest.skipUnless(installed_root(),'IRAF required')
class AutomaticIRAFTests(unittest.TestCase):
    def test_connected_image_and_spectrum_execution_both_backends(self):
        from giraf.task_catalog import catalog
        from giraf.generic_tasks import validate_generic
        from giraf.workflow import execute_workflow
        specs={s['name']:s for s in catalog()['tasks']}
        for backend in ('cl','pyraf'):
            with self.subTest(backend=backend), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp); image=np.arange(64,dtype=np.float32).reshape(8,8)
                fits.writeto(root/'source.fits',image)
                rows={'source':dict(id='source',name='source.fits',label='source.fits',path=str(root/'source.fits'),asset='image')}
                count=0
                def run(node,payload):
                    nonlocal count
                    s=specs[payload['task']]; self.assertTrue(s['runnable'],s['reason']); self.assertIn(s['schemaSource'],('iraf','parameters'))
                    m=validate_generic(s,dict(payload,backend=backend),rows.__getitem__)
                    job=root/f'job{count}'; count+=1; job.mkdir(); (job/'manifest.json').write_text(json.dumps(m))
                    p=subprocess.run([sys.executable,'-m','giraf.task_worker',str(job)],cwd=job,env=dict(os.environ,PYTHONPATH=str(Path(__file__).resolve().parents[1])),capture_output=True,text=True,timeout=45)
                    log=(job/'task.log').read_text() if (job/'task.log').exists() else p.stderr
                    self.assertEqual(p.returncode,0,log)
                    status=json.loads((job/'status.json').read_text());self.assertEqual(status['state'],'completed',log)
                    products=json.loads((job/'products.json').read_text())
                    for i,product in enumerate(products):
                        product.update(id=f'{job.name}-{i}',path=str(job/product['file']),name=product['label'])
                        rows[product['id']]=product
                    return dict(id=job.name,state=status['state'],products=products)
                graph={'nodes':[{'id':'a','label':'shrink','payload':{'task':'images.imgeom.blkavg','inputs':{'input':['source']},'parameters':{'b1':2,'b2':2}}}, {'id':'b','label':'stack','payload':{'task':'images.imutil.imstack','parameters':{}}}], 'links':[{'source':'a','target':'b','role':'images','kind':'image','multiple':True}]}
                state=execute_workflow(graph,run,lambda:False,lambda s:None)
                self.assertEqual(state['state'],'completed',state['message'])
                result=next(p for p in state['jobs'][-1]['products'] if p['asset']=='image')
                np.testing.assert_allclose(fits.getdata(result['path']).squeeze(),image.reshape(4,2,4,2).mean(axis=(1,3)))
                fits.writeto(root/'spectrum.fits',np.arange(1,33,dtype=np.float32)); rows['spectrum']=dict(id='spectrum',name='spectrum.fits',path=str(root/'spectrum.fits'),asset='image')
                job=run({},dict(task='noao.onedspec.scopy',inputs={'input':['spectrum']},parameters={}))
                result=next(p for p in job['products'] if p['asset']=='image')
                np.testing.assert_array_equal(fits.getdata(result['path']).squeeze(),np.arange(1,33))
                np.testing.assert_array_equal(fits.getdata(root/'source.fits'),image)


class OutputRoleTests(unittest.TestCase):
    def test_workflow_binds_only_selected_output_role(self):
        from giraf.workflow import execute_workflow
        seen=[]
        def run(node,payload):
            seen.append(payload)
            return dict(id=node['id'],state='completed',products=[dict(id='science',asset='image',role='science'),dict(id='mask',asset='image',role='mask')])
        graph=dict(nodes=[dict(id='a',label='a',payload={}),dict(id='b',label='b',payload={})],links=[dict(source='a',target='b',role='input',kind='image',multiple=False,sourceRole='science')])
        result=execute_workflow(graph,run,lambda:False,lambda s:None)
        self.assertEqual(result['state'],'completed',result['message'])
        self.assertEqual(seen[-1]['inputs']['input'],['science'])
