"""Validate generic task requests and launch isolated IRAF jobs."""
from __future__ import annotations
from datetime import datetime
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid
import hashlib
from copy import deepcopy

from .jobs import ROOT, RUNS, atomic_json
from .task_catalog import TASKS, SNAPSHOT, parameters, CALIBRATIONS
from .task_expressions import resolve_expression, inspect_expression
from .products import product_name

def digest(path):
    with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def authorize_file_plan(manifest,token):
    plan=manifest['filePlan']
    if plan['destructive'] and token!=plan['token']:raise ValueError('직접 변경할 파일과 백업 계획을 확인해 주세요.')
    manifest['fileAuthorized']=True

DEFAULT_MAPPING = {'imagetyp':'IMAGETYP', 'exptime':'EXPTIME', 'darktime':'DARKTIME', 'subset':'FILTER'}


def values(name, supplied):
    allowed = {p['name']:p for p in parameters(name)}
    if set(supplied) - set(allowed):
        raise ValueError(f'{name}: 알 수 없는 파라미터입니다: {", ".join(set(supplied)-set(allowed))}')
    result = {}
    for key, p in allowed.items():
        value = supplied.get(key, p['default'])
        if p['type'] == 'b':
            if value not in (True, False, 'yes', 'no'):
                raise ValueError(f'{key}: yes 또는 no를 선택해 주세요.')
            value = 'yes' if value in (True, 'yes') else 'no'
        elif p['type'] in ('i','r','d'):
            if str(value).upper() == 'INDEF':
                value = 'INDEF'
            else:
                try:
                    number = float(value)
                    if not math.isfinite(number) or (p['type']=='i' and number != int(number)):
                        raise ValueError()
                    value = int(number) if p['type']=='i' else number
                    if p['min'] != '' and value < float(p['min']): raise ValueError()
                    if p['max'] != '' and value > float(p['max']): raise ValueError()
                except (ValueError, TypeError, OverflowError):
                    raise ValueError(f'{key}: 유효한 {"정수" if p["type"]=="i" else "수치"}와 범위를 확인해 주세요.')
        else:
            value = str(value)
            if len(value)>500 or any(c in value for c in '\n\r\x00'):
                raise ValueError(f'{key}: 한 줄의 값을 입력해 주세요.')
        if p['choices'] and value not in p['choices']:
            raise ValueError(f'{key}: 허용되지 않은 값입니다.')
        result[key] = value
    return result


def validate_task(payload, resolve, *, diagnostics=False, pending_roles=frozenset()):
    name = payload.get('task')
    if name not in TASKS: raise ValueError('지원하는 IRAF task를 선택해 주세요.')
    spec = TASKS[name]
    if spec.get('adapter') == 'generic':
        from .generic_tasks import validate_generic
        return validate_generic(spec, payload, resolve, diagnostics=diagnostics, pending_roles=pending_roles)
    params = values(name, payload.get('parameters', {}))
    prep = values('ccdproc', payload.get('ccdproc', {}))
    package = values('ccdred', payload.get('ccdred', {}))
    backend = payload.get('backend','cl')
    if backend not in ('cl','pyraf'): raise ValueError('CL 또는 PyRAF를 선택해 주세요.')
    inputs = {}
    sources = {}
    roles = list(spec['inputs'])
    if spec.get('preprocess'): roles += CALIBRATIONS
    roles += [dict(name='instrument', label='기기 헤더 매핑 파일', multiple=False, kind='text')]
    supplied = deepcopy(payload.get('inputs', {}))
    expressions=payload.get('expressions',{})
    directory=str(Path(payload.get('workingDirectory') or ROOT).expanduser().resolve())
    allowed = {r['name'] for r in roles}
    if set(supplied)-allowed: raise ValueError('지원하지 않는 입력 역할입니다.')
    if set(expressions)-allowed:raise ValueError('지원하지 않는 표현식 역할입니다.')
    expression_rows={}
    for role in roles:
        expression=expressions.get(role['name'],'')
        if not expression:continue
        if role['kind']=='image':
            expanded=(inspect_expression if diagnostics else resolve_expression)(expression,directory)
        else:
            path=Path(expression).expanduser()
            if not path.is_absolute():path=Path(directory)/path
            path=path.resolve()
            expanded=[dict(id=hashlib.sha256(str(path).encode()).hexdigest()[:20],path=str(path),name=path.name,label=path.name,asset='text')]
        supplied[role['name']]=[r['id'] for r in expanded]
        expression_rows.update({r['id']:r for r in expanded})
    from .image_lists import expand_image_selection, accepts_asset
    input_lists = {}
    for role in roles:
        selection = supplied.get(role['name'], [])
        if not isinstance(selection, list) or any(not isinstance(i, str) for i in selection):
            raise ValueError('파일 ID 목록을 선택해 주세요.')
        expanded, list_sources = expand_image_selection(role, selection, lambda id: expression_rows[id] if id in expression_rows else resolve(id), directory, inspection=diagnostics)
        supplied[role['name']] = [row['id'] for row in expanded]
        expression_rows.update({row['id']: row for row in expanded})
        input_lists.update({row['path']: row for row in list_sources})
    for role in roles:
        ids = supplied.get(role['name'], [])
        if not isinstance(ids, list) or any(not isinstance(i,str) for i in ids): raise ValueError('파일 ID 목록을 선택해 주세요.')
        if role.get('required') and not ids and role['name'] not in pending_roles: raise ValueError(role['label']+'을 선택해 주세요.')
        if not role['multiple'] and len(ids)>1: raise ValueError(role['label']+'은 파일 한 개만 선택해 주세요.')
        inputs[role['name']] = ids
        for id in ids:
            row = deepcopy(expression_rows[id] if id in expression_rows else resolve(id))
            if not Path(row['path']).is_file(): raise ValueError((row.get('label') or row['name'])+': 파일이 없습니다.')
            if role['kind']=='image' and (row.get('asset','image')!='image' or row.get('error')):
                raise ValueError(row['name']+': IRAF가 읽을 수 있는 FITS 영상을 선택해 주세요.')
            if role['kind']=='text' and not accepts_asset('text', row.get('asset','image')):
                raise ValueError(row['name']+': 텍스트 파일을 선택해 주세요.')
            if not diagnostics: row['sha256']=digest(row['path'])
            sources[id] = row
    main = inputs[spec['inputs'][0]['name']]
    corrections = params if name=='ccdproc' else prep
    uses_prep = name=='ccdproc' or (spec.get('preprocess') and (params.get('process')=='yes' or name.startswith('mk')))
    if name=='mkskyflat' and not inputs.get('flat') and 'flat' not in pending_roles:
        raise ValueError('mkskyflat: sky 영상에 사용한 원래 flat 기준 영상을 선택해 주세요.')
    if uses_prep:
        for flag, role in [('zerocor','zero'),('darkcor','dark'),('flatcor','flat'),('illumcor','illum'),('fringecor','fringe')]:
            if corrections[flag]=='yes' and not inputs.get(role) and role not in pending_roles:
                raise ValueError(f'ccdproc.{flag}=yes: {role} 기준 영상을 선택하거나 해당 보정을 꺼 주세요.')
        if corrections['fixpix']=='yes' and not inputs.get('fixfile') and 'fixfile' not in pending_roles:
            raise ValueError('ccdproc.fixpix=yes: 불량 픽셀 영역 파일을 선택해 주세요.')
        for flag, field in [('overscan','biassec'),('trim','trimsec')]:
            if corrections[flag]=='yes' and not corrections[field]:
                # Header regions remain valid IRAF input; no invented geometry.
                from astropy.io import fits
                if main and any(not fits.getheader(sources[id]['path']).get(field.upper()) for id in main):
                    raise ValueError(f'ccdproc.{flag}=yes: {field} 영역을 지정해 주세요. 입력 헤더에도 영역이 없습니다.')
    if name=='ccdhedit' and not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,67}', params['parameter']):
        raise ValueError('편집할 헤더 parameter를 입력해 주세요. 예: subset')
    if params.get('clobber')=='yes':raise ValueError('clobber=yes: 설치 IRAF combine에서 폐기된 옵션입니다. 새 출력 경로를 사용해 주세요.')
    output = payload.get('output', {})
    output_name = str(output.get('name', spec['output']['default'] if spec['output'] else ''))
    inplace=name=='ccdproc' and payload.get('filePolicy',{}).get('mode')=='direct' and not output_name
    if spec['output'] and ((not output_name and not inplace) or len(output_name)>20000 or any(c in output_name for c in '\n\r\x00') or output_name in ('.','..')):
        raise ValueError('출력 이름 또는 IRAF 출력 목록을 한 줄로 입력해 주세요.')
    mapping = payload.get('mapping', DEFAULT_MAPPING)
    if set(mapping)!=set(DEFAULT_MAPPING) or any(not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,67}', str(v)) for v in mapping.values()):
        raise ValueError('헤더 매핑에 FITS 키워드를 입력해 주세요.')
    exam = payload.get('exam', {})
    if name=='imexamine' and diagnostics and not main and spec['inputs'][0]['name'] in pending_roles:
        if exam.get('key') not in ('r','a','m','l','c'): raise ValueError('지원하는 조사 동작을 선택해 주세요.')
        for group in ('rimexam','limexam','cimexam'):
            values(group, exam.get('parameters', {}).get(group, {}))
    if name=='imexamine' and not (diagnostics and not main and spec['inputs'][0]['name'] in pending_roles):
        try:
            x,y=float(exam['x']),float(exam['y'])
            row = sources[main[0]]
            if not (math.isfinite(x) and math.isfinite(y) and 1<=x<=row['width'] and 1<=y<=row['height']): raise ValueError()
        except (ValueError, KeyError, TypeError): raise ValueError('영상 안의 조사할 위치를 클릭해 주세요.')
        if exam.get('key') not in ('r','a','m','l','c'): raise ValueError('지원하는 조사 동작을 선택해 주세요.')
        exam = dict(x=x,y=y,key=exam['key'], parameters={n:values(n,exam.get('parameters',{}).get(n,{})) for n in ('rimexam','limexam','cimexam')})
    section = str(payload.get('section','')).strip()
    if section and not re.fullmatch(r'(?:\[[\w*,:+ -]+\])+', section):
        raise ValueError('영상 영역 형식을 확인해 주세요. 예: [500:1500,500:1500]')
    policy=payload.get('filePolicy',{'mode':'copy','backup':True})
    if policy.get('mode') not in ('copy','direct'):raise ValueError('파일 대상 모드를 선택해 주세요.')
    m=dict(operation='task', task=name, name=name, backend=backend, parameters=params,
                ccdproc=prep, ccdred=package, inputs=inputs, rows=list(sources.values()),
                output=dict(name=output_name), mapping=mapping, exam=exam, section=section,
                expressions=expressions,workingDirectory=directory,filePolicy=policy,instanceId=payload.get('instanceId'),
                settings=dict(task=name, backend=backend, **params))
    if spec['output']:
        output_paths(m)
    if diagnostics:
        m['warnings'] = []
        return m
    targets=[dict(path=r['path'],sha256=r['sha256'],role='input') for r in sources.values()]
    direct=policy.get('mode')=='direct'
    if direct and spec['output'] and name!='ccdhedit' and output_name:
        output_targets=output_paths(m)
        targets += [dict(path=str((Path(directory)/n).resolve()),role='output') for n in output_targets]
    plan=dict(mode=policy.get('mode'),destructive=direct,backup=bool(policy.get('backup',True)),targets=targets,
              output=output_name,delete=params.get('delete','no'),collision='IRAF가 기존 출력을 거부합니다. clobber는 사용하지 않습니다.',
              description='원본과 보정 기준을 직접 대상으로 실행합니다.' if direct else '실행 폴더의 보호 사본에서 실행합니다. 입력 삭제와 백업도 사본에 적용합니다.')
    m['inputLists']=list(input_lists.values())
    if input_lists: m['inputSelections']=deepcopy(payload.get('inputs', {}))
    plan['token']=hashlib.sha256(json.dumps(m,sort_keys=True).encode()).hexdigest()
    m['filePlan']=plan
    return m


def preview_task(manifest, *, paths=False):
    if manifest.get('adapter') == 'generic':
        from .generic_tasks import preview_generic
        return preview_generic(manifest)
    spec=TASKS[manifest['task']]
    rows={r['id']:r for r in manifest['rows']}
    ids=manifest['inputs'][spec['inputs'][0]['name']]
    output=spec['output']
    name=manifest['output']['name']
    if not output or manifest['parameters'].get('noproc')=='yes':
        return [dict(inputs=[rows[i].get('label',rows[i]['name']) for i in ids],output=manifest['task']+'-results.txt')]
    if output['mode'] in ('each','edit'):
        result=[dict(inputs=[rows[i].get('label',rows[i]['name'])], output=name+rows[i].get('label',rows[i]['name'])) for i in ids]
        if len(ids)==1 and not name.endswith('/') and (Path(name).suffix or '/' in name):
            result[0]['output']=name
    elif manifest['parameters'].get('subsets')=='yes':
        from astropy.io import fits
        grouped={}
        for i in ids:
            subset=str(fits.getheader(rows[i]['path']).get(manifest['mapping']['subset'], '')).strip()
            grouped.setdefault(subset,[]).append(rows[i].get('label',rows[i]['name']))
        result=[dict(inputs=v,output=str(Path(name).with_name(Path(name).stem+k+(Path(name).suffix or '.fits')))) for k,v in grouped.items()]
    elif manifest['parameters'].get('project')=='yes' and len(ids)>1:
        result=[dict(inputs=[rows[i].get('label',rows[i]['name'])],output=str(Path(name).with_name(Path(name).stem+f'_{n+1}'+(Path(name).suffix or '.fits')))) for n,i in enumerate(ids)]
    else:
        result=[dict(inputs=[rows[i].get('label',rows[i]['name']) for i in ids],output=name)]
    names=[r['output'] for r in result]
    if name.startswith('@'):
        path=Path(name[1:]);path=path if path.is_absolute() else Path(manifest['workingDirectory'])/path
        names=[line.strip() for line in path.read_text().splitlines() if line.strip() and not line.lstrip().startswith('#')]
    elif ',' in name:
        names=[n.strip() for n in name.split(',')]
    if len(names)!=len(result):
        raise ValueError('출력 목록 수가 실제 입력/출력 수와 다릅니다.')
    for row,value in zip(result,names):
        path=Path(value)
        label=product_name(path.name,spec['kind'])
        row['output']=str(path.with_name(label)) if paths else label
    return result


def output_paths(manifest):
    return [row['output'] for row in preview_task(manifest, paths=True)]


def start_task(manifest, folder):
    if manifest.get('filePlan',{}).get('destructive') and not manifest.get('fileAuthorized'):raise ValueError('직접 파일 변경 계획을 확인해 주세요.')
    job=RUNS/(datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6])
    job.mkdir(parents=True)
    manifest['workspace_folder']=folder
    atomic_json(job/'manifest.json',manifest)
    atomic_json(job/'status.json',dict(state='queued',message='IRAF task 준비 중',progress=0))
    env=os.environ.copy()
    env.update(PYRAF_NO_DISPLAY='1',PYTHONUNBUFFERED='1',PYTHONPATH=str(ROOT))
    try:
        with (job/'worker.log').open('w') as log:
            proc=subprocess.Popen([sys.executable,'-m','giraf.task_worker',str(job)],cwd=job,env=env,
                                  stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        atomic_json(job/'process.json',{'pid':proc.pid})
    except Exception as exc:
        atomic_json(job/'status.json',dict(state='failed',message=str(exc),progress=0))
        raise
    return job
