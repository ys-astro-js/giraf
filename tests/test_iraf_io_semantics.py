"""IRAF stream/internal parameters and native multiple outputs; specified first."""
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from astropy.io import fits
from giraf.task_capabilities import installed_root, read_parameters
from giraf.task_discovery import discover
from giraf.generic_tasks import GenericTaskRun, validate_generic


class SemanticSchemaTests(unittest.TestCase):
    def test_internal_list_is_proven_by_cl_assignment_not_its_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);pkg=root/'pkg/demo';pkg.mkdir(parents=True)
            (pkg/'demo.cl').write_text('package demo\ntask sample = "demo$sample.cl"\nclbye()\n')
            (pkg/'sample.par').write_text('input,s,a,,,,Input images\nreader,*s,h\nlist,*s,a,,,,List of values\n')
            (pkg/'sample.cl').write_text('procedure sample(input)\nbegin\nstring temp, line\ntemp = mktemp("tmp$sample")\nreader = temp\nwhile (fscan(reader, line) != EOF) print(line)\nreader = ""\nend\n')
            s=discover(root)['tasks']['demo.sample']
            self.assertTrue(s['runnable'],s['reason'])
            self.assertNotIn('reader',[p['name'] for p in s['inputs']+s['parameters']])
            self.assertIn('reader',[p['name'] for p in s['internalParameters']])
            stream=next(p for p in s['inputs'] if p['name']=='list')
            self.assertEqual(stream['valueType'],'list')
            self.assertIn('reader',str(s['ioEvidence']))

    def test_cursor_stream_and_scalar_cursor_are_distinct_and_unknown_file_is_not_guessed(self):
        from giraf.task_schema import parameter_profile
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'sample.par'
            p.write_text('events,*imcur,h,"",,,Image cursor\nposition,imcur,h,"",,,Cursor position\nunknown,f,h,"",,,Unclassified setting\n')
            result=parameter_profile(read_parameters(p))['profile']
            self.assertEqual([p['name'] for p in result['inputs']],['events'])
            self.assertEqual(result['inputs'][0]['valueType'],'cursor')
            self.assertEqual(result['inputs'][0]['cursorType'],'imcur')
            self.assertEqual(result['inputs'][0]['representation'],'command-file')

    def test_metacode_and_binary_outputs_do_not_become_text(self):
        from giraf.task_schema import parameter_profile
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'sample.par'
            p.write_text('input,s,a,,,,Input images\noutput,f,h,default,,,Output photometry files\nplotfile,f,h,"",,,Output plots metacode file\nraw,f,h,"",,,Output binary file\n')
            outputs=parameter_profile(read_parameters(p))['profile']['outputs']
            self.assertEqual([(x['name'],x['kind']) for x in outputs],[('output','text'),('plotfile','metacode'),('raw','binary')])
            self.assertEqual(outputs[0]['mode'],'each')
            self.assertEqual(outputs[1]['mode'],'single')


@unittest.skipUnless(installed_root(),'IRAF required')
class NativeOutputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tasks=discover()['tasks']

    def run_job(self,root,task,payload,rows):
        m=validate_generic(self.tasks[task],payload,rows.__getitem__)
        job=root/f'job{len(list(root.glob("job*")))}';job.mkdir()
        (job/'manifest.json').write_text(json.dumps(m))
        runner=GenericTaskRun(job);runner.execute()
        status=json.loads((job/'status.json').read_text())
        self.assertEqual(status['state'],'completed',(job/'task.log').read_text())
        return runner,json.loads((job/'products.json').read_text())

    def star_rows(self,root):
        rows={};y,x=np.mgrid[:64,:64]
        for key,dx in [('a',0),('b',2)]:
            path=root/(key+'.fits')
            fits.writeto(path,(100+5000*np.exp(-((x-31-dx)**2+(y-31)**2)/8)).astype('float32'))
            rows[key]=dict(id=key,name=path.name,path=str(path),asset='image')
        path=root/'coords.txt';path.write_text('32 32\n')
        rows['coords']=dict(id='coords',name=path.name,path=str(path),asset='text')
        return rows

    def test_imalign_uses_native_list_with_shared_trim_and_hides_internal_list(self):
        s=self.tasks['images.immatch.imalign']
        self.assertNotIn('list',[p['name'] for p in s['inputs']+s['parameters']])
        self.assertEqual(next(p for p in s['inputs'] if p['name']=='shifts')['kind'],'text')
        for backend in ('cl','pyraf'):
            with self.subTest(backend=backend),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);rows=self.star_rows(root)
                runner,products=self.run_job(root,s['name'],dict(backend=backend,inputs={'input':['a','b'],'reference':['a'],'coords':['coords']},parameters={'interp_type':'nearest'}),rows)
                self.assertEqual(len(runner.calls),1)
                self.assertTrue(runner.calls[0][0]['input'].startswith('@'))
                self.assertNotIn('list',runner.calls[0][0])
                images=[fits.getdata(runner.job/p['file']) for p in products if p['role']=='output']
                self.assertEqual(len(images),2)
                self.assertEqual(images[0].shape,images[1].shape)
                self.assertLess(images[0].shape[1],64)
                self.assertEqual(np.unravel_index(images[0].argmax(),images[0].shape),np.unravel_index(images[1].argmax(),images[1].shape))

    def test_phot_two_images_emit_two_tables_and_one_binary_plot_stream_both_backends(self):
        s=self.tasks['noao.digiphot.apphot.phot']
        self.assertEqual({p['name']:p['kind'] for p in s['outputs']},{'output':'text','plotfile':'metacode'})
        for backend in ('cl','pyraf'):
            with self.subTest(backend=backend),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);rows=self.star_rows(root)
                runner,products=self.run_job(root,s['name'],dict(backend=backend,inputs={'image':['a','b'],'coords':['coords']},outputs={'plotfile':'profiles.gki'},parameterSets={'photpars':{'apertures':'5'}}),rows)
                self.assertEqual(len(runner.calls),1)
                tables=[p for p in products if p['role']=='output'];plots=[p for p in products if p['role']=='plotfile']
                self.assertEqual(len(tables),2);self.assertEqual(len(plots),1)
                self.assertEqual(plots[0]['asset'],'metacode');self.assertTrue(plots[0]['file'].endswith('.gki'))
                for p in tables:self.assertIn('MAG',(runner.job/p['file']).read_text())
                self.assertGreater((runner.job/plots[0]['file']).stat().st_size,0)

    def test_cursor_replay_rejects_coordinate_table_and_measures_from_commands(self):
        s=self.tasks['noao.digiphot.apphot.phot']
        cursor=next(p for p in s['inputs'] if p['name']=='icommands')
        self.assertEqual(cursor['valueType'],'cursor')
        for backend in ('cl','pyraf'):
            with self.subTest(backend=backend),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);rows=self.star_rows(root)
                with self.assertRaisesRegex(ValueError,'icommands'):
                    validate_generic(s,dict(inputs={'image':['a'],'icommands':['coords']}),rows.__getitem__)
                commands=root/'cursor.txt';commands.write_text('32 32 1 \\040\nq\n')
                rows['commands']=dict(id='commands',name=commands.name,path=str(commands),asset='text')
                runner,products=self.run_job(root,s['name'],dict(backend=backend,inputs={'image':['a'],'icommands':['commands']}),rows)
                table=next(p for p in products if p['role']=='output')
                self.assertIn('MAG',(runner.job/table['file']).read_text())

    def test_daofind_collects_all_three_output_roles(self):
        for backend in ('cl','pyraf'):
            with self.subTest(backend=backend),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);rows=self.star_rows(root)
                runner,products=self.run_job(root,'noao.digiphot.apphot.daofind',dict(backend=backend,inputs={'image':['a','b']},outputs={'starmap':'density_','skymap':'sky_'},parameterSets={'datapars':{'sigma':1}}),rows)
                for role in ('output','starmap','skymap'):
                    self.assertEqual(len([p for p in products if p['role']==role]),2,products)

class InlineCursorTests(unittest.TestCase):
    def test_inline_commands_are_validated_staged_and_execute_without_external_cursor_file(self):
        if not installed_root():self.skipTest('IRAF required')
        task=discover()['tasks']['noao.digiphot.apphot.phot']
        helper=NativeOutputTests()
        for backend in ('cl','pyraf'):
            with self.subTest(backend=backend), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);rows=helper.star_rows(root)
                payload=dict(backend=backend,inputs={'image':['a']},cursorCommands={'icommands':'32 32 1 \\040\nq\n'})
                manifest=validate_generic(task,payload,rows.__getitem__)
                self.assertEqual(manifest['cursorCommands'],payload['cursorCommands'])
                job=root/'job';job.mkdir();(job/'manifest.json').write_text(json.dumps(manifest))
                runner=GenericTaskRun(job);runner.execute()
                self.assertEqual(json.loads((job/'status.json').read_text())['state'],'completed',(job/'task.log').read_text())
                records=runner.calls[0][0]['icommands']
                self.assertEqual((job/records).read_text(),payload['cursorCommands']['icommands'])
                products=json.loads((job/'products.json').read_text())
                self.assertIn('MAG',(job/next(p['file'] for p in products if p['role']=='output')).read_text())
                for commands in ({'icommands':'32 32\n'},{'image':'q\n'}):
                    with self.assertRaises(ValueError):validate_generic(task,dict(payload,cursorCommands=commands),rows.__getitem__)
                with self.assertRaises(ValueError):validate_generic(task,dict(payload,inputs={'image':['a'],'icommands':['coords']}),rows.__getitem__)
