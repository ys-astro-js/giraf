"""Execute declared IRAF tasks with frozen sources, settings and per-call outcomes."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import traceback
from copy import deepcopy
from astropy.io import fits

from .jobs import atomic_json
from .task_catalog import TASKS, SNAPSHOT, CAPABILITIES
from .task_jobs import output_paths
from .products import product_name, publish_product
from .task_expressions import split_image
from .task_session import run_process, Cancelled


def checksum(path):
    with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def literal(value):
    if value=='INDEF':return 'INDEF'
    if isinstance(value,(int,float)):return str(value)
    return '"'+str(value).replace('\\','\\\\').replace('"','\\"')+'"'

def qualified(name):
    return ('ccdred.' if name in SNAPSHOT['tasks'] and name not in ('imheader','imstatistics','imexamine','rimexam','limexam','cimexam','ccdred') else '')+name

def parameter_literal(name,key,value):
    p=next((p for p in SNAPSHOT['tasks'].get(name,[]) if p['name']==key),None)
    return str(value) if p and p['type']=='b' else literal(value)

class TaskRun:
    def __init__(self,job):
        self.job=Path(job).resolve();self.m=json.loads((self.job/'manifest.json').read_text());self.spec=TASKS[self.m['task']]
        self.aliases={};self.products=[];self.expected=[];self.assignments=[];self.calls=[];self.outcomes=[];self.references=[]
        self.rows={r['id']:r for r in self.m['rows']};self.direct=self.m.get('filePolicy',{}).get('mode')=='direct'
        self.dryrun=self.m['task']=='ccdproc' and self.m['parameters'].get('noproc')=='yes'
        self.interactive=(self.m['parameters'].get('interactive')=='yes' or (self.spec.get('preprocess') and self.m['parameters'].get('process')!='no' and self.m['ccdproc'].get('interactive')=='yes'))
        self.interactive=bool(self.interactive or (self.m['task']=='ccdinstrument' and self.m['parameters'].get('edit')=='yes'))
        self.directory=Path(self.m.get('workingDirectory',self.job))
        self.before={};self.subset_existing=set();self.call_sources=[];self.call_expected=[];self.mask_conversions=[]
    def state(self,message,progress=None,state='running'):
        atomic_json(self.job/'status.json',dict(state=state,message=message,progress=progress));print(message,flush=True)
    def list_value(self,role,section=''):
        paths=[self.aliases[i]+section for i in self.m['inputs'].get(role,[])]
        if not paths:return ''
        if len(paths)==1:return paths[0]
        file='lists/'+role+'.list';(self.job/file).write_text('\n'.join(paths)+'\n');return '@'+file
    def stage_reference(self,value,base,key):
        if not value:return value
        marker='@' if value.startswith('@') else '';raw=value.removeprefix('@');path,section=split_image(raw)
        p=Path(path).expanduser()
        if not p.is_absolute():p=base/p
        if not p.is_file():raise ValueError(f'{key}: 참조 파일이 없습니다: {p}')
        alias='references/r'+str(len(self.references))+p.suffix
        shutil.copy2(p,self.job/alias)
        self.references.append(dict(parameter=key,original=str(p.resolve()),alias=alias,sha256=checksum(p)))
        return marker+alias+section
    def package_path(self,value,key):
        if not value:return ''
        p=Path(value).expanduser()
        if self.direct:
            if not p.is_absolute():p=self.directory/p
            return str(p)
        if not p.is_absolute() and '..' not in p.parts:
            (self.job/p).parent.mkdir(parents=True,exist_ok=True);return value
        alias='package/'+key+'/'+p.name;(self.job/alias).parent.mkdir(parents=True,exist_ok=True)
        self.references.append(dict(parameter='ccdred.'+key,requested=value,alias=alias))
        return alias
    def target(self,index,label,ext='.fits'):
        if self.direct:
            p=Path(label).expanduser();p=p if p.is_absolute() else self.directory/p
            p.parent.mkdir(parents=True,exist_ok=True)
            if p.exists():raise ValueError(f'출력 충돌: {p} — 새 경로를 지정해 주세요.')
            return str(p)
        return f'output/o{index:05d}{ext}'
    def prepare(self):
        from .image_lists import check_input_lists
        check_input_lists(self.m)
        for folder in ('input','output','lists','uparm','references','backup'):(self.job/folder).mkdir(exist_ok=True)
        (self.job/'bin').mkdir(exist_ok=True)
        editor=self.job/'bin/vi'
        editor.write_text(f'#!{sys.executable}\nimport sys\nfrom giraf.task_session import edit_file\nedit_file({str(self.job)!r},sys.argv[-1])\n')
        editor.chmod(0o700)
        if self.direct and not self.m.get('fileAuthorized'):raise ValueError('직접 파일 변경 계획을 확인해 주세요.')
        sources=[]
        for index,row in enumerate(self.m['rows']):
            path=Path(row['path'])
            label=row.get('label') or path.name
            if not path.is_file():raise ValueError(f'{label}: 입력 파일이 없습니다.')
            if row.get('sha256') and checksum(path)!=row['sha256']:raise ValueError(f'{label}: 검증 이후 파일이 변경되었습니다. 다시 실행해 주세요.')
            ext=path.suffix.lower();alias=f'input/s{index:05d}'+(ext if ext else '.fits')
            shutil.copy2(path,self.job/alias)
            if self.direct and self.m.get('filePolicy',{}).get('backup',True):shutil.copy2(path,self.job/'backup'/Path(alias).name)
            self.aliases[row['id']]=(str(path) if self.direct else alias)+row.get('section','')
            sources.append(dict(id=row['id'],original=str(path),alias=self.aliases[row['id']],sha256=checksum(path)))
            if row.get('asset','image')=='image':
                with fits.open(path) as h:self.before[row['id']]=dict(h[0].header)
                if not self.direct and self.m['parameters'].get('masktype','none')!='none':
                    bpm=self.before[row['id']].get('BPM')
                    if bpm:
                        ref=self.stage_reference(str(bpm),path.parent,'BPM')
                        if Path(ref).suffix.lower() in ('.fits','.fit','.fts'):
                            converted=str(Path(ref).with_suffix('.pl'));self.mask_conversions.append((ref,converted));ref=converted
                        fits.setval(self.job/alias,'BPM',value=ref)
        atomic_json(self.job/'sources.json',sources)
        instrument=self.list_value('instrument')
        if not instrument:
            instrument='instrument.dat';(self.job/instrument).write_text(''.join(f'{k} {v}\n' for k,v in self.m['mapping'].items()))
        package=dict(self.m['ccdred'],instrument=instrument)
        for key in ('logfile','plotfile','backup'):package[key]=self.package_path(package.get(key,''),key)
        ss=package.get('ssfile','')
        if ss:
            p=Path(ss);p=p if p.is_absolute() else self.directory/p
            package['ssfile']=self.stage_reference(ss,self.directory,'ccdred.ssfile') if p.is_file() else self.package_path(ss,'ssfile')
        if package.get('cursor'):package['cursor']=self.stage_reference(package['cursor'],self.directory,'ccdred.cursor')
        elif self.interactive and self.m['backend']=='cl':package['cursor']='cursor.fifo'
        self.assignments.append(('ccdred',package))
        prep=dict(self.m['ccdproc'])
        for role in ('zero','dark','flat','illum','fringe','fixfile'):prep[role]=self.list_value(role)
        self.assignments.append(('ccdproc',prep))
        name=self.m['task'];params=dict(self.m['parameters'])
        for role in self.spec['inputs']:
            value=self.list_value(role['name'],self.m.get('section','') if role==self.spec['inputs'][0] else '')
            if value:params[role['name']]=value
            else:params[role['name']]=next((p['default'] for p in SNAPSHOT['tasks'][name] if p['name']==role['name']),'')
        if name=='combine':
            for key in ('scale','zero','weight'):
                if str(params.get(key,'')).startswith('@'):params[key]=self.stage_reference(params[key],self.directory,key)
        if name=='ccdinstrument':params['instrument']=instrument
        output=self.spec['output'];main=self.m['inputs'][self.spec['inputs'][0]['name']]
        names=output_paths(self.m) if output and not self.dryrun else []
        if output and output['mode'] in ('each','edit'):
            for i,id in enumerate(main):
                label=names[i] if names else self.rows[id].get('label',self.rows[id]['name'])
                if name in ('ccdproc','ccdhedit'):
                    inplace=self.direct and (name=='ccdhedit' or not self.m['output']['name'])
                    target=(str(self.rows[id]['path']) if inplace else self.target(i,label)) if self.direct else f'output/o{i:05d}.fits'
                    if not self.direct:shutil.copy2(self.rows[id]['path'],self.job/target)
                    call=dict(params,images=target+self.rows[id].get('section','')+self.m.get('section',''))
                    if name=='ccdproc':
                        call['output']=''
                        # Native IRAF's in-place overscan path can fault through
                        # PyRAF on this installation. A separate IRAF output also
                        # makes source/result correspondence explicit.
                        if params.get('overscan')=='yes' or (self.direct and not inplace):
                            call['images']=self.aliases[id]+self.m.get('section','')
                            if not self.direct:(self.job/target).unlink()
                            elif inplace:target=f'output/direct-{i:05d}.fits'
                            call['output']=target
                else:
                    target=self.target(i,label);call=dict(params);call[self.spec['inputs'][0]['name']]=self.aliases[id];call[output['name']]=target
                item=dict(file=target,label=Path(label).name,source=id,asset='image')
                if self.direct and name=='ccdproc' and inplace and params.get('overscan')=='yes':item['replaceTarget']=self.rows[id]['path']
                self.calls.append((name,call));self.call_sources.append([id]);self.call_expected.append([item]);self.expected.append(item)
        elif output:
            ext='.pl' if self.spec['kind']=='mask' else '.txt' if output['mode']=='text' else '.fits'
            label=names[0] if names else self.m['output']['name']
            if params.get('subsets')=='yes':
                params[output['name']]=str((self.directory/self.m['output']['name']).with_suffix('')) if self.direct else 'output/result'
                prefix=self.job/params[output['name']];self.subset_existing={str(p) for p in prefix.parent.glob(prefix.name+'*.fits')}
                expected=[]
            elif params.get('project')=='yes' and len(main)>1:
                expected=[];targets=[]
                for i,id in enumerate(main):
                    label=names[i]
                    target=self.target(i,label,ext);targets.append(target);expected.append(dict(file=target,label=Path(label).name,source=id,asset=self.spec['kind']))
                (self.job/'lists/project-output.list').write_text('\n'.join(targets)+'\n');params[output['name']]='@lists/project-output.list'
            else:
                target=self.target(0,label,ext);params[output['name']]=target
                expected=[dict(file=target,label=Path(label).name,asset=self.spec['kind'])]
            for role in ('plfile','sigma'):
                if params.get(role):
                    requested=Path(params[role]);label=product_name(requested.name,'image' if role=='sigma' else 'mask')
                    params[role]=self.target(1 if role=='sigma' else 2,str(requested.with_name(label)),'.fits' if role=='sigma' else '.pl')
                    item=dict(file=params[role],label=label,asset='image' if role=='sigma' else 'mask');expected.append(item);self.expected.append(item)
            self.calls.append((name,params));self.call_sources.append(main);self.call_expected.append(expected);self.expected+=expected
        elif name=='imexamine':
            exam=self.m['exam'];(self.job/'cursor.txt').write_text(f'{exam["x"]} {exam["y"]} 1 {exam["key"]}\n0 0 1 q\n')
            self.assignments+=list(exam['parameters'].items());params.update(use_display='no',imagecur='cursor.txt',graphcur='',logfile='exam.log',keeplog='yes',wcs='logical',graphics='stdgraph',frame=1,image='')
            self.calls.append((name,params));self.call_sources.append(main);self.call_expected.append([])
        else:self.calls.append((name,params));self.call_sources.append(main);self.call_expected.append([])
        atomic_json(self.job/'references.json',self.references)
        atomic_json(self.job/'commands.json',[dict(task=n,parameters=p) for n,p in self.calls])
        atomic_json(self.job/'assignments.json',[dict(task=n,parameters=p) for n,p in self.assignments])
        atomic_json(self.job/'effective.json',dict(requested=self.m,assignments=[dict(task=n,parameters=p) for n,p in self.assignments],calls=[dict(task=n,parameters=p) for n,p in self.calls],capabilities=CAPABILITIES))
        self.write_scripts()
    @staticmethod
    def pyvalue(v):return 'iraf.INDEF' if v=='INDEF' else repr(v)
    def write_scripts(self,only=None):
        bootstrap=['set uparm = '+literal(str(self.job/'uparm')+'/'),'set imtype = "fits"','set clobber = "no"','set editor = "vi"','print ("GIRAF_IRAF_VERSION ", envget("version"))','images','imutil','tv','noao','imred','ccdred']
        names=list(dict.fromkeys(['ccdred','ccdproc','combine',self.m['task']]+[n for n,p in self.assignments]))
        lines=bootstrap+['unlearn '+qualified(n) for n in names]
        py=['from pyraf import iraf',f'iraf.set(uparm={str(self.job/"uparm")+"/"!r}, imtype="fits", clobber="no",editor="vi")','print("GIRAF_IRAF_VERSION", iraf.envget("version"))','iraf.noao(_doprint=0)','iraf.imred(_doprint=0)','iraf.ccdred(_doprint=0)']
        if self.interactive:py+=['from giraf.task_session import install_pyraf',f'install_pyraf({str(self.job)!r})']
        for n in names:py.append(f'iraf.unlearn(iraf.getTask({qualified(n)!r}))')
        for source,target in self.mask_conversions:
            if not (self.job/target).exists():
                lines.append(f'imcopy ({literal(source)}, {literal(target)}, verbose=no)')
                py.append(f'iraf.imcopy({source!r},{target!r},verbose="no")')
        for name,params in self.assignments:
            for k,v in params.items():
                lines.append(f'{qualified(name)}.{k} = {parameter_literal(name,k,v)}');py.append(f'iraf.getTask({qualified(name)!r}).setParam({k!r}, {self.pyvalue(v)})')
        for i,(name,params) in enumerate(self.calls):
            if only is not None and i!=only:continue
            for k,v in params.items():lines.append(f'{qualified(name)}.{k} = {parameter_literal(name,k,v)}')
            required=[p['name'] for p in SNAPSHOT['tasks'][name] if p['mode']=='a' and p['name'] in params]
            arguments=', '.join(parameter_literal(name,k,params[k]) for k in required)
            graphic='interactive.gki' if self.interactive else 'graphics.gki'
            redir=f', >G "{graphic}"' if name=='imexamine' or self.interactive else ''
            lines += [f'lpar {qualified(name)} > "parameters-{i+1:03d}.txt"',f'{qualified(name)} ({arguments}{", " if arguments else ""}mode="h"{redir})',f'print ("GIRAF_TASK_{i+1}_DONE")']
            kwargs=', '.join(f'{k!r}: {self.pyvalue(v)}' for k,v in params.items() if k not in required);positional=', '.join(self.pyvalue(params[k]) for k in required)
            py.append(f'iraf.getTask({qualified(name)!r})({positional}{", " if positional else ""}**{{{kwargs}}}'+(', StdoutG="graphics.gki"' if name=='imexamine' else '')+')')
            py.append(f'iraf.lpar(iraf.getTask({qualified(name)!r}), Stdout="parameters-{i+1:03d}.txt")');py.append(f'print("GIRAF_TASK_{i+1}_DONE")')
        lines+=['print ("GIRAF_RUN_DONE")','logout'];py+=['print("GIRAF_RUN_DONE")']
        suffix='' if only is None else f'-{only+1:03d}'
        (self.job/f'commands{suffix}.cl').write_text('\n'.join(lines)+'\n');(self.job/f'commands{suffix}.py').write_text('\n'.join(py)+'\n')
    def execute(self):
        self.state('입력과 참조 파일 준비 중');self.prepare();backend=self.m['backend']
        binary=shutil.which('irafcl') or shutil.which('cl')
        if backend=='cl' and not binary:raise ValueError('IRAF CL을 찾지 못했습니다.')
        engine=dict(backend=backend,parameter_schema=SNAPSHOT['version'],python=sys.version,capabilities=CAPABILITIES)
        atomic_json(self.job/'engine.json',engine);diffs=[];accepted=set()
        for i,(name,params) in enumerate(self.calls):
            if (self.job/'cancel').exists():raise Cancelled('사용자가 중단했습니다.')
            self.state(f'{name} {i+1}/{len(self.calls)} 실행 중');self.write_scripts(i)
            command=[binary,'-f',str(self.job/f'commands-{i+1:03d}.cl')] if backend=='cl' else [sys.executable,str(self.job/f'commands-{i+1:03d}.py')]
            with (self.job/'task.log').open('ab') as log:
                start=log.tell();code=run_process(command,self.job,log,self.interactive,backend)
            text=(self.job/'task.log').read_bytes()[start:].decode(errors='replace')
            version=re.search(r'GIRAF_IRAF_VERSION\s+([^\r\n]+)',text)
            if version:engine['iraf_version']=version.group(1).strip()
            failed=bool(code or 'GIRAF_RUN_DONE' not in text or re.search(r'(?im)^\s*(?:(?:ERROR|PANIC|FATAL)(?:\s|:)|\*\*\s*Syntax error)',text.replace('\x07','')))
            if self.spec['output'] and params.get('subsets')=='yes' and not failed:
                prefix=self.job/params[self.spec['output']['name']]
                for path in sorted(prefix.parent.glob(prefix.name+'*.fits')):
                    if str(path) in self.subset_existing:continue
                    file=str(path) if self.direct else str(path.relative_to(self.job))
                    requested=Path(self.m['output']['name'])
                    subset=path.stem.removeprefix(prefix.name)
                    label=requested.stem+subset+(requested.suffix or '.fits')
                    item=dict(file=file,label=label,asset='image');self.call_expected[i].append(item);self.expected.append(item)
            for id in self.call_sources[i]:
                items=[q for q in self.call_expected[i] if q.get('source',id)==id]
                missing=any(not (self.job/q['file']).is_file() for q in items)
                skipped=bool(self.spec['output'] and params.get('subsets')=='yes' and not items and not failed)
                if name=='ccdproc' and items and not failed and not missing:
                    path=self.job/items[0]['file']
                    skipped=checksum(path)==self.rows[id].get('sha256')
                state='failed' if failed or missing else 'skipped' if skipped else 'planned' if self.dryrun else 'processed'
                self.outcomes.append(dict(source=id,label=self.rows[id].get('label',self.rows[id]['name']),state=state,message=text[-3000:] if state=='failed' else 'IRAF가 파일을 변경하지 않았습니다.' if skipped else 'IRAF task 완료'))
                if state in ('processed','planned'):
                    for item in items:
                        if self.dryrun:continue
                        accepted.add(item['file'])
                    if name=='ccdhedit' and items:
                        after=dict(fits.getheader(self.job/items[0]['file']));before=self.before[id]
                        for key in before.keys()|after.keys():
                            if before.get(key)!=after.get(key):diffs.append(dict(source=id,key=key,before=str(before[key]) if key in before else None,after=str(after[key]) if key in after else None))
            atomic_json(self.job/'outcomes.json',self.outcomes)
        atomic_json(self.job/'engine.json',engine);atomic_json(self.job/'header-diff.json',diffs)
        self.products=[p for p in self.expected if p['file'] in accepted]
        known={p['file'] for p in self.expected}
        failed_all=all(x['state']=='failed' for x in self.outcomes)
        if not failed_all and not self.dryrun:
            for path in sorted((self.job/'output').iterdir()):
                rel=str(path.relative_to(self.job))
                if rel in known or not path.is_file():continue
                label=Path(self.m['output']['name']).stem+path.name.removeprefix('result') if path.name.startswith('result') else path.name
                self.products.append(dict(file=rel,label=label,asset='image' if path.suffix=='.fits' else 'mask' if path.suffix=='.pl' else 'text'))
        # Direct-mode results are versioned copies; downstream references never point
        # at a mutable original. Backup paths remain in the execution record.
        for i,p in enumerate(self.products):
            if p.get('replaceTarget'):
                shutil.copy2(self.job/p['file'],p['replaceTarget']);p['target']=p.pop('replaceTarget')
            if Path(p['file']).is_absolute():
                saved='output/version-'+str(i)+Path(p['file']).suffix;shutil.copy2(p['file'],self.job/saved);p['target']=p['file'];p['file']=saved
        if self.m['task']=='ccdinstrument' and not failed_all:
            for key in ('instrument','ssfile'):
                value=next(p for n,p in self.assignments if n=='ccdred').get(key,'')
                path=self.job/value if value else None
                if path and path.is_file():
                    saved='output/'+key+'.dat';shutil.copy2(path,self.job/saved);self.products.append(dict(file=saved,label=key+'.dat',asset='text'))
        from .gki_svg import render_gki
        for source,target in [('graphics.gki','profile.svg'),('interactive.gki','interactive.svg')]:
            if (self.job/source).exists() and render_gki(self.job/source,self.job/target):self.products.append(dict(file=target,label=target,asset='plot'))
        self.products.append(dict(file='task.log',label=self.m['task']+'-results.txt',asset='text',role='$log'))
        self.products=[publish_product(self.job,p,i) for i,p in enumerate(self.products)]
        atomic_json(self.job/'products.json',self.products)
        states={x['state'] for x in self.outcomes}
        state='failed' if states=={'failed'} else 'partial' if 'failed' in states else 'skipped' if states=={'skipped'} else 'completed'
        self.state(f'{self.m["task"]} '+{'failed':'실패','partial':'부분 실패','skipped':'건너뜀','completed':'완료'}[state],1,state)

def main():
    from .generic_tasks import GenericTaskRun
    manifest=json.loads((Path(sys.argv[1])/'manifest.json').read_text())
    runner=(GenericTaskRun if manifest.get('adapter') == 'generic' else TaskRun)(sys.argv[1])
    try:runner.execute()
    except Cancelled as exc:runner.state(str(exc),None,'cancelled');return 0
    except Exception as exc:
        traceback.print_exc();runner.state(str(exc),None,'failed');return 1
    return 0

if __name__=='__main__':sys.exit(main())
