"""Build portable workflow schemas from a matching IRAF source tree.

Usage: python scripts/build_task_schemas.py SOURCE_ROOT
The generated cache is bound to installed parameter hashes. This is a build
step; users do not author per-task JSON or provide source to run bundled tasks.
"""
import hashlib,json,sys,re,subprocess
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from giraf.task_capabilities import installed_root,read_parameters
from giraf.task_discovery import discover
from giraf.task_schema import arguments
from giraf.spp_schema import analyze_source, ANALYSIS_VERSION
root=installed_root().resolve();source=Path(sys.argv[1]).resolve();result={}
prepared=set()
def prepare_sources(folder):
    """Use IRAF's own generic expander for explicit mkpkg generation rules."""
    for recipe in folder.rglob('mkpkg'):
        if recipe in prepared:continue
        prepared.add(recipe)
        for template, output in re.findall(r'\$\(GEN\)\s+(\S+\.gx)\s+-o\s+(\S+\.x)',recipe.read_text()):
            generator=root/'unix/bin/generic.e'
            if not generator.is_file():
                raise RuntimeError(f'IRAF generic is required to expand {recipe.parent/template}')
            subprocess.run([str(generator),'-k',template,'-o',output],cwd=recipe.parent,check=True)
known=discover()['tasks']
for identity,spec in known.items():
    par=next((Path(p) for p in spec['schemaFiles'] if Path(p).name==spec['taskName']+'.par'),None)
    if not par:continue
    folder=source/par.parent.relative_to(root)
    source_par=folder/par.name
    if not source_par.is_file() or source_par.read_bytes()!=par.read_bytes():continue
    candidates=list(folder.rglob('t_'+spec['taskName']+'.x')) if folder.exists() else []
    if len(candidates)!=1:continue
    path=candidates[0]
    prepare_sources(path.parent)
    inferred=analyze_source(read_parameters(par),path)
    inferred['sourceFiles']={str(Path(p).relative_to(source)):value for p,value in inferred['sourceFiles'].items()}
    inferred['sourceHash']=hashlib.sha256(json.dumps(inferred['sourceFiles'],sort_keys=True).encode()).hexdigest()
    for item in [*inferred['evidence'], *inferred.get('parameterConstraints',{}).values()]:
        if item.get('path'):item['path']=str(Path(item['path']).relative_to(source))
    inferred.update(parameterHash=hashlib.sha256(par.read_bytes()).hexdigest(),sourcePath=str(path.relative_to(source)))
    if inferred['profile']['inputs'] or inferred['profile']['outputs'] or inferred.get('hints'):result[identity]=inferred
# CL procedures which only delegate an invocation inherit its actual argument
# mapping. No task names or help language are used as a dispatch table.
for identity,spec in known.items():
    if identity in result:continue
    par=next((Path(p) for p in spec['schemaFiles'] if Path(p).name==spec['taskName']+'.par'),None)
    if not par:continue
    script=par.with_suffix('.cl')
    if not script.is_file():continue
    code='\n'.join(l.split('#',1)[0] for l in script.read_text().splitlines())
    body=re.search(r'\bbegin\s+(.*?)\s+end\s*$',code,re.S)
    if not body:continue
    call=re.fullmatch(r'\s*(\w+)\s*\((.*)\)\s*',body[1],re.S)
    if not call:continue
    callee=next((k for k in known if k.rsplit('.',1)[0]==identity.rsplit('.',1)[0] and k.endswith('.'+call[1])),None)
    if not callee:continue
    profile=result.get(callee,{}).get('profile')
    if not profile:continue
    cp=next((Path(p) for p in known[callee]['schemaFiles'] if Path(p).name==call[1]+'.par'),None)
    positional=[p['name'] for p in read_parameters(cp) if 'h' not in p.get('mode','')]
    binding={};index=0
    for arg in arguments(call[2]):
        match=re.match(r'^(\w+)\s*=(.*)$',arg,re.S)
        if match:binding[match[1]]=match[2].strip()
        elif index<len(positional):binding[positional[index]]=arg.strip();index+=1
    names={p['name'] for p in read_parameters(par)};adapted={'inputs':[],'outputs':[]};valid=True
    for direction in adapted:
        for slot in profile[direction]:
            bound=binding.get(slot['name'])
            if bound in names:
                updated=dict(slot,name=bound);updated.pop('label',None);updated.pop('scalar',None);adapted[direction].append(updated)
            elif direction=='outputs':valid=False
            elif bound not in ('""',"''"):valid=False
    if valid and adapted['inputs'] and adapted['outputs']:
        result[identity]=dict(analysisVersion=ANALYSIS_VERSION,complete=result[callee].get('complete',False),profile=adapted,evidence=[dict(call=call[1],bindings=binding)],parameterHash=hashlib.sha256(par.read_bytes()).hexdigest(),sourceHash=hashlib.sha256(script.read_bytes()).hexdigest(),sourcePath=str(script.relative_to(root)))
target=Path(__file__).resolve().parents[1]/'giraf/task_schemas.json'
target.write_text(json.dumps(dict(version=1,irafVersion='2.18.1',tasks=result),ensure_ascii=False,indent=2)+'\n')
print('Generated',len(result),'task schemas')
