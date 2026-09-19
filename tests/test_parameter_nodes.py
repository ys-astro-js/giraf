"""Parameter-driven node contracts, specified before implementation."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from giraf.task_capabilities import read_parameters
from giraf.task_discovery import discover
from giraf.generic_tasks import GenericTaskRun, validate_generic, preview_generic


class ParameterNodeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.pkg = self.root / 'pkg/demo'
        self.pkg.mkdir(parents=True)
        (self.pkg / 'demo.cl').write_text('package demo\ntask measure = "demo$x.e"\nclbye()\n')

    def spec(self, text):
        (self.pkg / 'measure.par').write_text(text)
        return discover(self.root)['tasks']['demo.measure']

    def test_parameter_only_package_generates_ports_controls_and_evidence(self):
        s = self.spec('source,f,a,"",,,Input images\nproduct,f,a,"",,,Output images\ntitle,s,h,"",,,Title of output image\nformat,s,h,fits,fits|imh,,Output image format\nsigma,r,a,2.5,0,10,Noise\nmode,s,h,ql\n')
        self.assertTrue(s['runnable'], s['reason'])
        self.assertEqual([(x['name'], x['kind'], x['multiple']) for x in s['inputs']], [('source', 'image', True)])
        self.assertEqual([(x['name'], x['mode']) for x in s['outputs']], [('product', 'each')])
        self.assertEqual({p['name'] for p in s['parameters']}, {'title', 'format', 'sigma'})
        self.assertEqual(s['schemaSource'], 'parameters')
        self.assertTrue(s['ioEvidence'])
        self.assertEqual(s['parameters'][-1]['mode'], 'a')

    def test_strings_are_controls_without_a_descriptor_and_stdout_is_connectable(self):
        s = self.spec('message,s,a,"hello",,,Message to print\n')
        self.assertTrue(s['runnable'], s['reason'])
        self.assertEqual([p['name'] for p in s['parameters']], ['message'])
        self.assertEqual(s['outputs'][0]['name'], '$stdout')
        m = validate_generic(s, {}, lambda key: None)
        self.assertEqual(m['parameters']['message'], 'hello')

    def test_empty_obsolete_file_roles_do_not_block_parameters_after_schema_reload(self):
        s = self.spec('nrejmasks,s,h,"",,,Optional destination\nscale,s,h,none,,,Scaling method\n')
        payload = dict(inputs={'nrejmasks': [], 'scale': []},
                       expressions={'nrejmasks': '', 'scale': ''},
                       parameters={'nrejmasks': '', 'scale': 'median'})
        m = validate_generic(s, payload, lambda key: self.fail('No files should be resolved'))
        self.assertEqual(m['inputs'], {})
        self.assertEqual(m['expressions'], {})
        self.assertEqual(m['parameters'], {'nrejmasks': '', 'scale': 'median'})
        self.assertEqual(payload['inputs'], {'nrejmasks': [], 'scale': []})

    def test_obsolete_nonempty_or_unknown_file_roles_are_not_silently_discarded(self):
        s = self.spec('nrejmasks,s,h,"",,,Optional destination\n')
        for payload in (
            {'inputs': {'nrejmasks': ['selected-file']}},
            {'expressions': {'nrejmasks': 'selected.fits'}},
            {'inputs': {'unknown': []}},
            {'expressions': {'unknown': ''}},
            {'inputs': {'nrejmasks': None}},
            {'expressions': {'nrejmasks': None}},
        ):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                validate_generic(s, payload, lambda key: self.fail('Invalid roles must be rejected'))

    def test_misleading_descriptions_are_not_file_roles(self):
        s = self.spec('title,s,h,"",,,Title of output image\nsection,s,h,"",,,Input image section\nunits,s,h,pixel,,,Output coordinate units\nfields,s,h,"",,,List of output fields\n')
        self.assertEqual(s['inputs'], [])
        self.assertEqual([p['name'] for p in s['outputs']], ['$stdout'])
        self.assertEqual(len(s['parameters']), 4)

    def test_scalar_operands_cursor_files_and_optional_outputs(self):
        s = self.spec('operand,f,a,"",,,Operand image or numerical constant\nresult,f,a,"",,,Resultant image\ncoords,*imcur,h,"",,,Image cursor commands\nvariance,f,h,"",,,Output variance image\n')
        self.assertTrue(s['runnable'], s['reason'])
        self.assertTrue(s['inputs'][0]['scalar'])
        self.assertFalse(s['inputs'][0]['required'])
        self.assertEqual(s['inputs'][1]['kind'], 'text')
        self.assertTrue(s['outputs'][1]['optional'])
        m = validate_generic(s, {'parameters': {'operand': '2'}}, lambda key: None)
        self.assertEqual([p['role'] for p in preview_generic(m)], ['result'])
        job = self.root / 'job'; job.mkdir(); (job/'manifest.json').write_text(json.dumps(m))
        r = GenericTaskRun(job); r.prepare()
        self.assertEqual(r.calls[0][0]['variance'], '')
        self.assertEqual(r.calls[0][0]['operand'], '2.0')

    def test_source_evidence_overrides_prompt_without_losing_scalar_controls(self):
        (self.pkg / 't_measure.x').write_text('procedure t_measure()\nbegin\ncall clgstr ("source", a, 100)\ncall clgstr ("product", b, 100)\ni = immap (a, READ_ONLY, 0)\no = immap (b, NEW_COPY, i)\nend\n')
        s = self.spec('source,s,a,"",,,Output file\nproduct,s,a,"",,,Input file\ntitle,s,h,"",,,Title of output image\n')
        self.assertEqual([(p['name'], p['kind']) for p in s['inputs']], [('source', 'image')])
        self.assertEqual([p['name'] for p in s['outputs']], ['product'])
        self.assertEqual([p['name'] for p in s['parameters']], ['title'])

    def test_list_parameter_file_is_passed_as_list_source_not_at_template(self):
        s = self.spec('values,*r,a,"",,,Values to average\n')
        data = self.root/'values.txt'; data.write_text('1\n2\n')
        row = dict(id='v', name=data.name, path=str(data), asset='text')
        self.assertTrue(s['runnable'], s['reason'])
        m = validate_generic(s, {'inputs': {'values': ['v']}}, lambda key: row)
        job = self.root/'job'; job.mkdir(); (job/'manifest.json').write_text(json.dumps(m))
        r = GenericTaskRun(job); r.prepare()
        self.assertEqual(r.calls[0][0]['values'], 'input/s00000.txt')

    def test_paired_input_lists_broadcast_and_reject_misalignment(self):
        s = self.spec('source,f,a,"",,,Input images\nreference,f,a,"",,,Reference images\nproduct,f,a,"",,,Output images\n')
        rows = {}
        for name in ('a','b','c','d','e'):
            path=self.root/(name+'.fits'); path.write_bytes(b'fixture')
            rows[name]=dict(id=name,name=path.name,path=str(path),asset='image')
        m=validate_generic(s, {'inputs': {'source':['a','b'],'reference':['c','d']}}, rows.__getitem__)
        job=self.root/'job';job.mkdir();(job/'manifest.json').write_text(json.dumps(m))
        r=GenericTaskRun(job);r.prepare()
        self.assertEqual(len(r.calls),1)
        listing=r.calls[0][0]['reference']
        self.assertTrue(listing.startswith('@'))
        paths=(job/listing[1:]).read_text().splitlines()
        self.assertEqual(len(paths),2)
        self.assertNotEqual(paths[0],paths[1])
        with self.assertRaisesRegex(ValueError, 'reference'):
            validate_generic(s, {'inputs': {'source':['a','b'],'reference':['c','d','e']}}, rows.__getitem__)

    def test_parser_preserves_quoted_whitespace_comments_and_numeric_notation(self):
        path=self.pkg/'sample.par'
        path.write_text('  # a comment\nmessage,s,h,"  a,#b  ",,,"First line\n# literal line"\nscale,d,h,1.5D2,0,2D2,Scale\nangle,r,h,12:30:00,,,Angle\n')
        pars=read_parameters(path)
        self.assertEqual(pars[0]['default'],'  a,#b  ')
        self.assertEqual(pars[0]['prompt'],'First line\n# literal line')
        self.assertEqual(pars[1]['default'],150)
        self.assertEqual(pars[2]['default'],12.5)
        from giraf.generic_tasks import checked_values
        self.assertEqual(checked_values(pars[1:], {})['scale'],150)

    def test_broken_rows_are_reported_instead_of_silently_dropped(self):
        (self.pkg/'measure.par').write_text('bad,row\n')
        result=discover(self.root)
        self.assertNotIn('demo.measure',result['tasks'])
        self.assertTrue(result['diagnostics'])

    def test_unresolved_indirection_is_preserved_for_iraf_not_sent_as_literal(self):
        s=self.spec('version,s,h,)cl.release,,,Version\n')
        self.assertTrue(s['runnable'],s['reason'])
        self.assertEqual(s['parameters'][0]['default'],')cl.release')
        m=validate_generic(s,{},lambda key:None)
        self.assertNotIn('version',m['parameters'])

    def test_pset_can_be_found_in_a_package_subdirectory(self):
        nested=self.pkg/'pars';nested.mkdir()
        (nested/'controls.par').write_text('gain,r,h,2,0,,Gain\n')
        s=self.spec('controls,pset,h,"",,,Controls\n')
        self.assertTrue(s['runnable'],s['reason'])
        self.assertEqual(s['parameterSets'][0]['parameters'][0]['name'],'gain')

    def test_installed_standard_task_does_not_depend_on_bundled_profiles(self):
        from giraf.task_capabilities import installed_root
        if not installed_root(): self.skipTest('IRAF required')
        real=Path.read_text
        def without_cache(path,*args,**kwargs):
            if path.name in ('task_profiles.json','task_schemas.json'): return '{"version":1,"tasks":{}}'
            return real(path,*args,**kwargs)
        with patch.object(Path,'read_text',without_cache):
            tasks=discover()['tasks']
        for name in ('images.imutil.imcopy','images.imfilter.gauss','noao.digiphot.apphot.phot','noao.onedspec.sarith'):
            s=tasks[name]
            self.assertTrue(s['runnable'], s['reason'])
            self.assertTrue(s['inputs'],name)
            self.assertTrue(s['outputs'],name)
