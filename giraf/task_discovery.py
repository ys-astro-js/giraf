"""Read IRAF package declarations without evaluating CL code.

Discovery compiles parameters into forms and workflow ports. Optional source
evidence refines file roles; optional external descriptors override exceptions. No IRAF package is executed in the web server during discovery.
"""
import hashlib
import json
import os
from pathlib import Path
import re

from .task_capabilities import installed_root, read_parameters

IDENT = r'[A-Za-z_][A-Za-z0-9_]*'
PACKAGE = re.compile(r'^\s*package\s+(' + IDENT + r')\b', re.M)
DECLARATION = re.compile(r'^\s*task\s+([\w$.,\s]+?)\s*=\s*[\'\"]?([^\s\'\"\n]+)', re.M)


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def env_paths(name):
    return [Path(p).expanduser() for p in os.environ.get(name, '').split(os.pathsep) if p]


def discover(root=None, extra_roots=(), descriptors=()):
    root = Path(root) if root else installed_root()
    diagnostics = []
    roots = [(root / name, False) for name in ('pkg', 'noao') if root and (root / name).is_dir()]
    if root and (root / 'extern').is_dir():
        roots += [(p, True) for p in sorted((root / 'extern').iterdir()) if p.is_dir()]
    roots += [(Path(p).resolve(), True) for p in extra_roots]
    packages = {}
    all_pars = {}
    for folder, external in roots:
        if not folder.is_dir():
            diagnostics.append(f'패키지 경로가 없습니다: {folder}')
            continue
        for path in sorted(folder.rglob('*.par')):
            all_pars.setdefault(path.stem, []).append(path)
        for path in sorted(folder.rglob('*.cl')):
            try:
                source = '\n'.join(line.split('#', 1)[0] for line in path.read_text(errors='replace').splitlines())
                match = PACKAGE.search(source)
                if not match or match[1] != path.stem:
                    continue
                packages[path.parent] = dict(leaf=match[1], path=path.resolve(), folder=folder.resolve(), external=external, source=source)
            except OSError as exc:
                diagnostics.append(str(exc))
    for folder, pkg in packages.items():
        ancestors = [p for parent, p in packages.items() if parent == folder or parent in folder.parents]
        ancestors.sort(key=lambda p: len(p['path'].parts))
        pkg['name'] = '.'.join(p['leaf'] for p in ancestors)
        pkg['loadPackages'] = [p['leaf'] for p in ancestors]
        pkg['bootstrap'] = dict(name=ancestors[0]['leaf'], path=str(ancestors[0]['path'])) if pkg['external'] else None

    overrides = {}
    for path in map(Path, descriptors):
        try:
            data = json.loads(path.read_text())
            if data.get('version') != 1 or not isinstance(data.get('tasks'), dict):
                raise ValueError('version=1 및 tasks 객체가 필요합니다.')
            for name, profile in data['tasks'].items():
                overrides[name] = profile
        except (OSError, ValueError) as exc:
            diagnostics.append(f'{path}: {exc}')

    generated_path = Path(__file__).with_name('task_schemas.json')
    generated = json.loads(generated_path.read_text()).get('tasks', {}) if generated_path.exists() else {}
    tasks = {}
    task_descriptions = {}
    for folder, pkg in sorted(packages.items(), key=lambda item: item[1]['name']):
        menu = folder / (pkg['leaf'] + '.men')
        descriptions = dict(re.findall(r'^\s*(\w+)\s+-\s+(.+)$', menu.read_text(), re.M)) if menu.is_file() else {}
        task_descriptions.update({pkg['name'] + '.' + key: value for key, value in descriptions.items()})
        declarations = {}
        for names, target in DECLARATION.findall(pkg['source']):
            for name in re.split(r'[,\s]+', names.strip()):
                if re.fullmatch(IDENT, name):
                    declarations[name] = target
        for name, target in declarations.items():
            if target.endswith('.par') or name.startswith('_'):
                continue
            candidates = all_pars.get(name, [])
            path = folder / (name + '.par')
            if not path.exists():
                path = next((p for p in candidates if folder in p.parents), None)
            if path is None:
                # A declaration with no .par is not a fabricated runnable form.
                continue
            identity = pkg['name'] + '.' + name
            files = {str(path.resolve()): file_hash(path)}
            for parent in [folder, *folder.parents]:
                if parent in packages:
                    script = packages[parent]['path']; files[str(script)] = file_hash(script)
            issues = []
            sets = []
            seen = set()
            try:
                parameters = read_parameters(path)
                package_file = folder / (pkg['leaf'] + '.par')
                if package_file.exists():
                    files[str(package_file.resolve())] = file_hash(package_file)
                    sets.append(dict(name='$package', task=pkg['leaf'], parameters=read_parameters(package_file)))

                def psets(pars, base, chain=()):
                    for p in pars:
                        if p['type'] != 'pset':
                            continue
                        ref = str(p['default'] or p['name'])
                        if not re.fullmatch(IDENT, ref):
                            issues.append(f'{p["name"]}: pset 참조를 해석할 수 없습니다.')
                            continue
                        if ref in chain:
                            issues.append(f'{ref}: 순환 pset 참조입니다.')
                            continue
                        if ref in seen:
                            continue
                        seen.add(ref)
                        source = base / (ref + '.par')
                        if not source.exists():
                            source = folder / (ref + '.par')
                        if not source.exists():
                            nearby = [p for p in all_pars.get(ref, []) if folder in p.parents]
                            if not nearby:
                                nearby = all_pars.get(ref, [])
                            if len(nearby) == 1:
                                source = nearby[0]
                        if not source.exists():
                            for package in packages.values():
                                for declared, target in DECLARATION.findall(package['source']):
                                    if ref in re.split(r'[,\s]+', declared.strip()) and target.endswith('.par'):
                                        stem = Path(target.split('$')[-1]).stem
                                        candidates = all_pars.get(stem, [])
                                        if len(candidates) == 1:
                                            source = candidates[0]
                        if not source.exists():
                            issues.append(f'{ref}: pset 정의를 찾지 못했습니다.')
                            continue
                        nested = read_parameters(source)
                        files[str(source.resolve())] = file_hash(source)
                        sets.append(dict(name=ref, task=pkg['leaf'] + '.' + ref, parameters=nested))
                        psets(nested, source.parent, (*chain, ref))
                psets(parameters, path.parent)
                for group in list(sets):
                    psets(group['parameters'], folder)
                # Resolve inherited defaults using the owning package/pset, not CCD settings.
                lookup = {s['name']: {p['name']: p['default'] for p in s['parameters']} for s in sets}
                def inherited(value, visited=()):
                    if not isinstance(value, str) or not value.startswith(')'):
                        return value
                    ref = value[1:]
                    if ref in visited or '.' not in ref:
                        raise ValueError(f'{ref}: 파라미터 간접 참조를 해석할 수 없습니다.')
                    owner, key = ref.rsplit('.', 1)
                    owner = '$package' if owner in ('_', pkg['leaf']) else owner
                    if key not in lookup.get(owner, {}):
                        raise ValueError(f'{ref}: 파라미터 간접 참조를 해석할 수 없습니다.')
                    return inherited(lookup[owner][key], (*visited, ref))
                for par in parameters + [p for s in sets for p in s['parameters']]:
                    try:
                        par['default'] = inherited(par['default'])
                    except ValueError:
                        # IRAF resolves global/package references when the task
                        # is loaded. Preserve these defaults and omit assignments.
                        par['indirect'] = par['default']
                spec = dict(name=identity, taskName=name, package=pkg['name'], qualified=pkg['leaf'] + '.' + name,
                            title=name, description=descriptions.get(name, ''), adapter='generic',
                            inputs=[], outputs=[], output=None, kind='text', parameters=parameters,
                            parameterSets=sets, loadPackages=pkg['loadPackages'], bootstrap=pkg['bootstrap'],
                            schemaFiles=files, schemaFingerprint=hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest())
                from .task_schema import node_profile, internal_parameters, refine_help
                from .spp_schema import analyze_source, ANALYSIS_VERSION
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
                tasks[identity] = spec
            except (OSError, ValueError) as exc:
                diagnostics.append(f'{identity}: {exc}')
    return dict(tasks=tasks, diagnostics=diagnostics, descriptions=task_descriptions)


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
                from .task_schema import file_extension
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
