"""Layered node schemas over IRAF inference: reviewed GIRAF defaults, then user files.

Each file patches one task by name. Presentation and structure are applied
automatically; problems are reported as schema issues for workflow diagnostics.
A malformed file fails closed: the task is not runnable until it is fixed.
"""
import json
import re
from pathlib import Path

from .jobs import DATA
from .task_discovery.packages import IDENT, file_hash, env_paths

BUNDLED = Path(__file__).resolve().parent / 'schemas'
USER = DATA / 'user-schemas'
KINDS = ('image', 'text', 'mask', 'metacode', 'binary')
TOP = {'version', 'task', 'title', 'description', 'inputs', 'outputs', 'parameters', 'groups', 'components'}
PORT_FIELDS = {
    'inputs': {'kind': str, 'label': str, 'multiple': bool, 'required': bool},
    'outputs': {'kind': str, 'label': str, 'mode': str, 'default': str, 'optional': bool},
}
PARAMETER_FIELDS = {'label', 'default', 'fixed'}
PLANNED_COMPONENTS = ('image-cursor', 'value-output', 'value-input', 'ccd-preprocess', 'calibration-groups')
KEY = re.compile(rf'^(?:{IDENT}\.)?{IDENT}$')


def schema_directories():
    return [('giraf', BUNDLED), ('user', USER), *(('user', p) for p in env_paths('GIRAF_SCHEMA_DIRS'))]


def load_layers(directories=None):
    """Read (layer, folder) pairs in order. Returns ({task: [layer]}, diagnostics)."""
    layers, diagnostics = {}, []
    for name, folder in schema_directories() if directories is None else directories:
        for path in sorted(Path(folder).glob('*.json')) if Path(folder).is_dir() else []:
            try:
                data = json.loads(path.read_text())
            except (OSError, ValueError) as exc:
                diagnostics.append(f'{path}: 스키마를 읽지 못했습니다. {exc}')
                continue
            if not isinstance(data, dict) or not isinstance(data.get('task'), str):
                diagnostics.append(f'{path}: task 필드가 필요합니다.')
                continue
            layers.setdefault(data['task'], []).append(dict(
                layer=name, source=str(path.resolve()), hash=file_hash(path), patch=data, errors=format_errors(data)))
    return layers, diagnostics


def format_errors(data):
    errors = []
    if data.get('version') != 2:
        errors.append('version은 2여야 합니다.')
    errors += [f'{key}: 알 수 없는 필드입니다.' for key in sorted(set(data) - TOP)]
    for key in ('title', 'description'):
        if key in data and not isinstance(data[key], str):
            errors.append(f'{key}: 문자열이어야 합니다.')
    for direction, fields in PORT_FIELDS.items():
        ports = data.get(direction, {})
        if not isinstance(ports, dict):
            errors.append(f'{direction}: 이름을 키로 하는 객체여야 합니다.')
            continue
        for name, port in ports.items():
            where = f'{direction}.{name}'
            if not re.fullmatch(IDENT, name):
                errors.append(f'{where}: 올바른 파라미터 이름이 아닙니다.')
            elif port is not None and not isinstance(port, dict):
                errors.append(f'{where}: 객체 또는 null이어야 합니다.')
            elif port:
                errors += [f'{where}.{k}: 알 수 없는 필드입니다.' for k in sorted(set(port) - set(fields))]
                errors += [f'{where}.{k}: 자료형이 올바르지 않습니다.' for k, typ in fields.items() if k in port and type(port[k]) is not typ]
                if 'kind' in port and port['kind'] not in KINDS:
                    errors.append(f'{where}.kind: {", ".join(KINDS)} 중 하나여야 합니다.')
                if port.get('mode', 'single') not in ('single', 'each'):
                    errors.append(f'{where}.mode: single 또는 each여야 합니다.')
    parameters = data.get('parameters', {})
    if not isinstance(parameters, dict):
        errors.append('parameters: 이름을 키로 하는 객체여야 합니다.')
    else:
        for key, entry in parameters.items():
            where = f'parameters.{key}'
            if not KEY.fullmatch(key):
                errors.append(f'{where}: 파라미터 또는 pset.파라미터 형식이어야 합니다.')
            elif not isinstance(entry, dict):
                errors.append(f'{where}: 객체여야 합니다.')
            else:
                errors += [f'{where}.{k}: 알 수 없는 필드입니다.' for k in sorted(set(entry) - PARAMETER_FIELDS)]
                if 'label' in entry and not isinstance(entry['label'], str):
                    errors.append(f'{where}.label: 문자열이어야 합니다.')
                errors += [f'{where}.{k}: 문자열, 수치 또는 불리언이어야 합니다.' for k in ('default', 'fixed')
                           if k in entry and not isinstance(entry[k], (str, int, float, bool))]
    groups = data.get('groups', [])
    if not isinstance(groups, list) or not all(
            isinstance(g, dict) and set(g) == {'label', 'parameters'} and isinstance(g['label'], str)
            and isinstance(g['parameters'], list) and all(isinstance(p, str) for p in g['parameters']) for g in groups):
        errors.append('groups: {label, parameters} 객체의 목록이어야 합니다.')
    components = data.get('components', [])
    if not isinstance(components, list):
        errors.append('components: 목록이어야 합니다.')
    else:
        for item in components:
            kind = item.get('type') if isinstance(item, dict) else None
            planned = ' (예정된 구성 요소)' if kind in PLANNED_COMPONENTS else ''
            errors.append(f'components: {kind or "type 없음"}은 아직 지원하지 않습니다{planned}.')
    return errors


def merge_layers(profile, parameters, sets, layers):
    """Patch an inferred profile. Returns (profile, presentation, issues, provenance).

    Unknown references are warnings and are skipped; they typically follow an
    IRAF update. Format errors are returned as errors and must fail closed.
    """
    issues, provenance = [], {}
    pars = {p['name']: p for p in parameters}
    set_pars = {s['name']: {p['name'] for p in s['parameters']} for s in sets}
    ports = {d: {s['name']: dict(s) for s in profile[d]} for d in ('inputs', 'outputs')}
    presentation = dict(parameters={}, groups=None)
    fixed = dict(profile.get('fixed', {}))
    warn = lambda message: issues.append(dict(severity='warning', message=message))
    for layer in layers:
        if layer['errors']:
            issues += [dict(severity='error', message=f'{Path(layer["source"]).name}: {e}') for e in layer['errors']]
            continue
        patch, name = layer['patch'], layer['layer']
        for key in ('title', 'description'):
            if key in patch:
                presentation[key] = patch[key]
                provenance[key] = name
        for direction in ('inputs', 'outputs'):
            other = 'outputs' if direction == 'inputs' else 'inputs'
            for role, port in patch.get(direction, {}).items():
                where = f'{direction}.{role}'
                if role not in pars:
                    warn(f'{where}: IRAF 정의에 없는 파라미터입니다.')
                    continue
                if port is None:
                    if ports[direction].pop(role, None) is None:
                        warn(f'{where}: 제거할 포트가 없습니다.')
                    provenance[where] = name
                    continue
                if role not in ports[direction] and 'kind' not in port:
                    warn(f'{where}: 새 포트에는 kind가 필요합니다.')
                    continue
                ports[other].pop(role, None)
                fixed.pop(role, None)
                ports[direction][role] = {**ports[direction].get(role, {'name': role}), **port}
                provenance.update({f'{where}.{k}': name for k in port})
        for key, entry in patch.get('parameters', {}).items():
            owner, _, field = key.rpartition('.')
            known = field in set_pars.get(owner, ()) if owner else field in pars
            if not known:
                warn(f'parameters.{key}: IRAF 정의에 없는 파라미터입니다.')
                continue
            if 'fixed' in entry and not owner and any(field in ports[d] for d in ports):
                warn(f'parameters.{key}: 파일 포트는 fixed로 고정할 수 없습니다.')
                entry = {k: v for k, v in entry.items() if k != 'fixed'}
            presentation['parameters'].setdefault(key, {}).update(entry)
            if 'fixed' in entry and not owner:
                fixed[field] = entry['fixed']
            provenance.update({f'parameters.{key}.{k}': name for k in entry})
        if 'groups' in patch:
            presentation['groups'] = patch['groups']
            provenance['groups'] = name
    order = {name: i for i, name in enumerate(pars)}
    merged = {d: sorted(ports[d].values(), key=lambda s: order.get(s['name'], len(order))) for d in ports}
    return dict(merged, fixed=fixed), presentation, issues, provenance


def apply_presentation(spec, presentation, issues, provenance, layers):
    """Apply labels, new-node defaults, pset fixed values and display groups."""
    from .generic_tasks.validation import checked_values
    warn = lambda message: issues.append(dict(severity='warning', message=message))
    for key in ('title', 'description'):
        if key in presentation:
            spec[key] = presentation[key]
    entries = presentation['parameters']
    for p in spec['parameters']:
        entry = entries.get(p['name'], {})
        if 'label' in entry: p['label'] = entry['label']
        if 'default' in entry: p['default'] = entry['default']
    if spec.get('fixed'):
        pars = {p['name']: p for p in spec.get('allParameters', spec['parameters'])}
        for name, value in list(spec['fixed'].items()):
            if name not in {k for k, e in entries.items() if 'fixed' in e}:
                continue  # Pre-existing v1 descriptor values are validated by IRAF.
            try:
                spec['fixed'][name] = checked_values([pars[name]], {name: value})[name]
            except ValueError as exc:
                warn(f'parameters.{name}.fixed: {exc}')
                del spec['fixed'][name]
    for group in spec['parameterSets']:
        prefix = group['name'] + '.'
        group['allParameters'] = list(group['parameters'])
        group['fixed'] = {}
        for p in group['parameters']:
            entry = entries.get(prefix + p['name'], {})
            if 'label' in entry: p['label'] = entry['label']
            if 'default' in entry: p['default'] = entry['default']
            if 'fixed' in entry:
                try:
                    group['fixed'][p['name']] = checked_values([p], {p['name']: entry['fixed']})[p['name']]
                except ValueError as exc:
                    warn(f'parameters.{prefix}{p["name"]}.fixed: {exc}')
        group['parameters'] = [p for p in group['parameters'] if p['name'] not in group['fixed']]
    if presentation['groups'] is not None:
        visible = {p['name'] for p in spec['parameters']} | {
            g['name'] + '.' + p['name'] for g in spec['parameterSets'] for p in g['parameters']}
        groups = []
        for group in presentation['groups']:
            missing = [key for key in group['parameters'] if key not in visible]
            for key in missing:
                warn(f'groups.{group["label"]}: {key}는 설정 탭에 표시할 수 없는 파라미터입니다.')
            groups.append(dict(label=group['label'], parameters=[k for k in group['parameters'] if k in visible]))
        spec['groups'] = groups
    spec['schemaLayers'] = [dict(layer=l['layer'], source=l['source']) for l in layers]
    spec['schemaProvenance'] = provenance
    spec['schemaIssues'] = issues
    return spec
