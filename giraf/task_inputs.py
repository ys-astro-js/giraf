"""Resolve legacy CCD task file roles and retain their validation contract."""
from copy import deepcopy
from pathlib import Path
import hashlib
from .task_expressions import resolve_expression, inspect_expression


def resolve_task_inputs(spec, payload, directory, resolve, digest, calibrations, *, diagnostics, pending_roles):
    inputs = {}
    sources = {}
    roles = list(spec['inputs'])
    if spec.get('preprocess'): roles += calibrations
    roles += [dict(name='instrument', label='기기 헤더 매핑 파일', multiple=False, kind='text')]
    supplied = deepcopy(payload.get('inputs', {}))
    expressions=payload.get('expressions',{})
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
    return inputs, sources, input_lists, expressions
