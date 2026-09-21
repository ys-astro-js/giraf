"""Source-derived I/O contracts. Written before implementation."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from giraf.task_capabilities import read_parameters, installed_root
from giraf.task_schema import infer_profile, node_profile, refine_help


class SourceContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.par = self.root/'task.par'
        self.par.write_text('input,s,a,,,,Misleading title\noutput,s,a,,,,Input image\nproject,b,h,no,,,Project\n')
        self.parameters = read_parameters(self.par)

    def test_unresolved_file_delegation_is_not_a_complete_contract(self):
        source = '''procedure t_task()
begin
files = imtopenp ("input")
products = imtopenp ("output")
n = imtgetim (files, input, 100)
im = immap (input, READ_ONLY, 0)
call unknown_writer (products)
end
'''
        result = infer_profile(self.parameters, source)
        self.assertFalse(result['complete'])
        self.assertIn('output', str(result['issues']))
        self.assertEqual(result['profile']['inputs'][0]['name'], 'input')

    def test_delegated_io_constants_and_cardinality_survive_misleading_help(self):
        from giraf.spp_schema import analyze_source
        entry = self.root/'t_task.x'
        entry.write_text('''procedure t_task()
begin
files = imtopenp ("input")
products = imtopenp ("output")
project = clgetb ("project")
n = imtlen (files)
if (project) {
    if (imtlen (products) != n)
        call error (1, "Wrong count")
} else {
    if (imtlen (products) != 1)
        call error (1, "Wrong count")
}
k = imtgetim (files, src, 100)
k = imtgetim (products, dst, 100)
call delegate (src, dst, NEW_COPY)
end
''')
        helper=self.root/'helper.x'
        helper.write_text('''procedure delegate (src, dst, access)
begin
im = immap (src, READ_ONLY, 0)
out = immap (dst, access, im)
call printf ("unknown_writer (dst)")
end
''')
        result = analyze_source(self.parameters, entry)
        self.assertTrue(result['complete'], result['issues'])
        self.assertEqual(result['profile']['outputs'][0]['eachWhen'], 'project')
        self.assertEqual(result['profile']['outputs'][0]['mode'], 'single')
        self.assertIn(str(helper.resolve()), result['sourceFiles'])
        # Dictionary settings remain controls, even with file alternatives.
        self.par.write_text(self.par.read_text()+'method,s,h,none,,,Input images\nalgorithm,s,h,none,,,Algorithm\n')
        self.parameters = read_parameters(self.par)
        entry.write_text(entry.read_text().replace('call delegate', 'a = clgwrd ("algorithm", word, 100, METHODS)\ncall setting ("method", METHODS)\ncall delegate'))
        definitions=self.root/'options.h'
        definitions.write_text('define METHODS "|none|median|"\n')
        helper.write_text('include "options.h"\n'+helper.read_text()+'''procedure setting (parameter, dictionary)
begin
call clgstr (parameter, value, 100)
if (value[1] == '@') {
    fd = open (value[2], READ_ONLY, TEXT_FILE)
} else if (value[1] == '!') {
    x = imgetr (im, value[2])
} else {
    type = strdic (value, value, 100, dictionary)
}
end
''')
        entry.write_text('include "options.h"\n'+entry.read_text())
        result=analyze_source(self.parameters, entry)
        self.assertIn(str(definitions.resolve()), result['sourceFiles'])
        self.assertEqual(result['parameterConstraints']['method']['choices'], ['none','median'])
        self.assertEqual(result['parameterConstraints']['method']['prefixes'], ['!','@'])
        self.assertTrue(result['parameterConstraints']['algorithm']['closed'])
        generated=node_profile(self.parameters, result)
        refine_help(generated, self.parameters, '.ih\nPARAMETERS\n.ls output\nInput images.\n.le\n')
        self.assertEqual([s['name'] for s in generated['profile']['inputs']], ['input'])
        self.assertEqual([s['name'] for s in generated['profile']['outputs']], ['output'])
        helper.write_text(helper.read_text().replace('NEW_COPY', 'NEW_IMAGE')+'\n')
        self.assertNotEqual(analyze_source(self.parameters, entry)['sourceHash'], result['sourceHash'])
        self.par.write_text('catalog,frt,h,"",,,Catalog\nproduct,fn,h,"",,,Product\n')
        declared=read_parameters(self.par)
        self.assertEqual(declared[0]['declaredType'],'frt')
        self.assertEqual(declared[0]['fileChecks'],['readable','text'])
        self.assertEqual(declared[1]['fileChecks'],['absent'])

    def test_discovery_hashes_helper_dependencies(self):
        from giraf.task_discovery import discover
        pkg=self.root/'pkg/demo'; pkg.mkdir(parents=True)
        (pkg/'demo.cl').write_text('package demo\ntask task = "demo$x.e"\nclbye()\n')
        (pkg/'task.par').write_text(self.par.read_text())
        (pkg/'t_task.x').write_text('procedure t_task()\nbegin\ncall clgstr ("input", a, 100)\ncall clgstr ("output", b, 100)\ncall helper (a, b)\nend\n')
        helper=pkg/'helper.x';helper.write_text('procedure helper (a, b)\nbegin\ni = immap (a, READ_ONLY, 0)\no = immap (b, NEW_COPY, i)\nend\n')
        first=discover(self.root)['tasks']['demo.task']
        self.assertIn(str(helper.resolve()),first['schemaFiles'])
        helper.write_text(helper.read_text()+'\n')
        self.assertNotEqual(first['schemaFingerprint'],discover(self.root)['tasks']['demo.task']['schemaFingerprint'])

    def test_old_cache_is_not_reported_as_verified_source(self):
        from giraf.task_discovery import discover
        pkg=self.root/'pkg/demo';pkg.mkdir(parents=True)
        (pkg/'demo.cl').write_text('package demo\ntask task = "demo$x.e"\nclbye()\n')
        (pkg/'task.par').write_text(self.par.read_text())
        from giraf.task_discovery import file_hash
        import json
        stale={'tasks':{'demo.task':dict(complete=True,parameterHash=file_hash(pkg/'task.par'), profile=dict(inputs=[],outputs=[],fixed={}))}}
        read=Path.read_text
        with patch.object(Path,'read_text',lambda p,*a,**k:json.dumps(stale) if p.name=='task_schemas.json' else read(p,*a,**k)):
            task=discover(self.root)['tasks']['demo.task']
        self.assertEqual(task['schemaSource'],'parameters')

    @unittest.skipUnless(installed_root(), 'IRAF required')
    def test_installed_combine_contract_does_not_need_help_prose(self):
        from giraf.task_discovery import discover
        read=Path.read_text
        with patch.object(Path,'read_text',lambda p,*a,**k:'' if p.suffix=='.hlp' else read(p,*a,**k)):
            s=discover()['tasks']['images.immatch.imcombine']
        self.assertEqual([v['name'] for v in s['inputs']],['input'])
        self.assertEqual({v['name'] for v in s['outputs']},{'output','headers','bpmasks','rejmasks','nrejmasks','expmasks','sigmas'})
        for slot in s['outputs']:
            self.assertEqual(slot['mode'],'single')
            self.assertEqual(slot['eachWhen'],'project')
            self.assertEqual(slot['kind'], 'image' if slot['name'] in ('output','headers','sigmas') else 'mask')
        self.assertTrue(any('icombine' in str(e) and e.get('access')=='NEW_COPY' for e in s['ioEvidence']))
        self.assertIn('sourceAnalysis',s)
        self.assertEqual(s['parameterConstraints']['scale']['choices'], ['none','mode','median','mean','exposure'])
        self.assertEqual(s['parameterConstraints']['scale']['prefixes'], ['!','@'])
