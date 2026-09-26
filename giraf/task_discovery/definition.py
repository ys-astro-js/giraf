"""Build one runnable task definition from its package and source evidence."""
import hashlib
import json
import re
from .packages import IDENT, file_hash
from .parameters import read_task_parameters


def task_definition(name, path, pkg, packages, all_pars, generated, overrides, description):
    folder = pkg['path'].parent
    identity = pkg['name'] + '.' + name
    files = {str(path.resolve()): file_hash(path)}
    for parent in [folder, *folder.parents]:
        if parent in packages:
            script = packages[parent]['path']; files[str(script)] = file_hash(script)
    parameters, sets, issues = read_task_parameters(path, folder, pkg, packages, all_pars, files)
    spec = dict(name=identity, taskName=name, package=pkg['name'], qualified=pkg['leaf'] + '.' + name,
                title=name, description=description, adapter='generic',
                inputs=[], outputs=[], output=None, kind='text', parameters=parameters,
                parameterSets=sets, loadPackages=pkg['loadPackages'], bootstrap=pkg['bootstrap'],
                schemaFiles=files, schemaFingerprint=hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest())
    from ..task_schema import node_profile, internal_parameters, refine_help
    from ..spp_schema import analyze_source, ANALYSIS_VERSION
    source_paths = list(folder.glob('t_' + name + '.x')) + list(folder.glob('src/t_' + name + '.x'))
    inferred = None
    if source_paths:
        source_path = source_paths[0]
        inferred = analyze_source(parameters, source_path)
        files.update(inferred['sourceFiles'])
    else:
        entry = generated.get(identity)
        if entry and entry.get('analysisVersion') == ANALYSIS_VERSION and entry['parameterHash'] == file_hash(path):
            inferred = entry
    script = path.with_suffix('.cl')
    internal = internal_parameters(parameters, script.read_text()) if script.is_file() else []
    if script.is_file():
        files[str(script.resolve())] = file_hash(script)
    spec['internalParameters'] = internal
    public = [p for p in parameters if p not in internal]
    for parameter in public:
        constraint = (inferred or {}).get('parameterConstraints', {}).get(parameter['name'])
        if constraint:
            parameter['sourceConstraint'] = constraint
            if constraint.get('closed') and not parameter['choices']:
                parameter['choices'] = constraint['choices']
    spec['parameters'] = public
    automatic = node_profile(public, inferred)
    help_path = folder / 'doc' / (name + '.hlp')
    if help_path.is_file():
        files[str(help_path.resolve())] = file_hash(help_path)
        automatic = refine_help(automatic, public, help_path.read_text(errors='replace'))
    automatic['evidence'] += [dict(parameter=p['name'], source='cl-assignment',
                                   role='internal', path=str(script)) for p in internal]
    profile = overrides.get(identity, automatic['profile'])
    spec['schemaSource'] = 'override' if identity in overrides else 'iraf' if inferred and inferred.get('complete') else 'parameters'
    spec['ioEvidence'] = automatic['evidence']
    spec['parameterConstraints'] = inferred.get('parameterConstraints', {}) if inferred else {}
    spec['sourceAnalysis'] = dict(complete=inferred.get('complete', False), issues=inferred.get('issues', [])) if inferred else dict(complete=False, issues=['No matching source analysis'])
    spec['sourceHash'] = inferred.get('sourceHash') if inferred else None
    # Batch defaults remain editable controls. They are not hidden
    # per-task overrides and do not decide whether a node exists.
    for par in parameters + [p for group in sets for p in group['parameters']]:
        if par['type'] == 'b' and (par['name'] in ('interactive', 'verify', 'update') or 'interactive mode' in par.get('prompt', '').lower()):
            par['irafDefault'] = par['default']
            par['default'] = 'no'
    try:
        apply_profile(spec, profile)
        if identity not in overrides and not spec['outputs']:
            spec['outputs'] = [dict(name='$stdout', label='표준 출력', kind='text', mode='single', default=name+'.txt')]
    except (ValueError, KeyError, TypeError) as exc:
        issues.append(f'작업 정보를 불러오지 못했습니다: {exc}')
    spec['schemaFingerprint'] = hashlib.sha256(json.dumps(dict(files=files,profile=profile,source=spec.get('sourceHash')),sort_keys=True).encode()).hexdigest()
    spec['parameters'] = [p for p in spec['parameters'] if p['name'] not in ('mode', '$nargs') and p['type'] != 'pset']
    for group in spec['parameterSets']:
        group['parameters'] = [p for p in group['parameters'] if p['name'] not in ('mode', '$nargs') and p['type'] != 'pset']
    spec['runnable'] = not issues
    spec['reason'] = ' '.join(dict.fromkeys(issues))
    return spec


def apply_profile(spec, profile):
    if not isinstance(profile, dict) or set(profile) - {'inputs', 'outputs', 'fixed', 'title', 'description'}:
        raise ValueError('허용되지 않는 작업 정의 필드입니다.')
    if not isinstance(profile.get('inputs'), list) or not isinstance(profile.get('outputs'), list):
        raise ValueError('inputs와 outputs 목록을 선언해 주세요.')
    pars = {p['name']: p for p in spec['parameters']}
    used = set()
    for direction in ('inputs', 'outputs'):
        slots = []
        for raw in profile[direction]:
            name = raw['name']
            if name not in pars or name in used or not re.fullmatch(IDENT, name):
                raise ValueError(f'{name}: 파라미터가 없거나 중복된 역할입니다.')
            if raw.get('kind') not in ('image', 'text', 'mask', 'metacode', 'binary'):
                raise ValueError(f'{name}: image, text, mask, metacode, binary 중 파일 종류를 지정해 주세요.')
            if pars[name]['type'] not in ('s', 'f', 'gcur', 'imcur', 'ukey') and not pars[name]['type'].startswith('*'):
                raise ValueError(f'{name}: 파일 역할에 사용할 수 없는 타입입니다.')
            used.add(name)
            item = dict(raw)
            item['parameterType'] = pars[name]['type']
            item['parameterMode'] = pars[name].get('mode', '')
            item.setdefault('representation', 'file')
            item.setdefault('label', name)
            if direction == 'inputs':
                item.setdefault('multiple', True); item.setdefault('required', False)
                if item.get('scalar') and item['required']:
                    raise ValueError(f'{name}: 상수 대체 입력은 required=false여야 합니다.')
            else:
                from ..task_schema import file_extension
                item.setdefault('mode', 'single'); item.setdefault('default', name + file_extension(item['kind']))
                if item['mode'] not in ('single', 'each'):
                    raise ValueError(f'{name}: 지원하지 않는 출력 개수입니다.')
                if item['mode'] == 'each' and not profile['inputs']:
                    raise ValueError(f'{name}: 입력마다 출력을 만들려면 입력이 필요합니다.')
            slots.append(item)
        spec[direction] = slots
    fixed = profile.get('fixed', {})
    if not isinstance(fixed, dict) or any(k not in pars or not re.fullmatch(IDENT, k) for k in fixed):
        raise ValueError('fixed에 알 수 없는 파라미터가 있습니다.')
    if set(fixed) & used:
        raise ValueError('파일 역할을 fixed로 덮어쓸 수 없습니다.')
    spec['fixed'] = fixed
    for p in spec['parameters']:
        if p['name'] in fixed or p['name'] in used: continue
        if p['type'] not in ('b', 'i', 'r', 'd', 's', 'f', 'pset', 'gcur', 'imcur', 'ukey', 'struct') and not p['type'].startswith('*'):
            raise ValueError(f'{p["name"]}: {p["type"]} 타입은 어댑터가 필요합니다.')
    spec['title'] = profile.get('title', spec['title'])
    spec['description'] = profile.get('description', spec['description'])
    spec['kind'] = spec['outputs'][0]['kind'] if spec['outputs'] else 'text'
    spec['parameters'] = [p for p in spec['parameters'] if p['name'] not in used | set(fixed) | {'mode', '$nargs'} and p['type'] != 'pset'
                          or any(s['name'] == p['name'] and s.get('scalar') for s in spec['inputs'])]
    for group in spec['parameterSets']:
        group['parameters'] = [p for p in group['parameters'] if p['name'] not in ('mode', '$nargs') and p['type'] != 'pset']
    # Keep the complete raw schema for serialization of managed file/fixed values.
    spec['allParameters'] = list(pars.values())
