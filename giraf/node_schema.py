"""Layered node schemas over IRAF inference: reviewed GIRAF defaults, then user files.

Each file patches one task by name. Presentation and structure are applied
automatically; problems are reported as schema issues for workflow diagnostics.
A malformed file fails closed: the task is not runnable until it is fixed.

A file whose task is in the `giraf.` namespace defines a node of GIRAF's own
(file input, file save, …) instead of patching an IRAF task. Its ports carry
their kinds and one run or flow component says what it does.
"""
import json
import re
from pathlib import Path

from .jobs import DATA
from .task_discovery.packages import IDENT, file_hash, env_paths

BUNDLED = Path(__file__).resolve().parent / 'schemas'
USER = DATA / 'user-schemas'
KINDS = ('image', 'text', 'mask', 'metacode', 'binary')
# A GIRAF node also passes image lists on; an input may take every kind.
NODE_KINDS = KINDS + ('image-list',)
ANY = 'any'
NODE_PREFIX = 'giraf.'
TOP = {'version', 'task', 'title', 'description', 'icon', 'inputs', 'outputs', 'parameters', 'groups', 'components', 'pinned'}
PORT_FIELDS = {
    'inputs': {'kind': str, 'label': str, 'multiple': bool, 'required': bool, 'sources': list},
    'outputs': {'kind': str, 'label': str, 'mode': str, 'default': str, 'optional': bool, 'from': str},
}
# Where an input's files may come from: chosen files, an IRAF expression,
# another node's output, text typed in place, recorded cursor commands.
SOURCES = ('files', 'expression', 'node', 'text', 'cursor')
# Symbols a GIRAF node shows in the add-task popover.
NODE_ICONS = ('file-input', 'folder-down', 'variable', 'file-search', 'calculator', 'repeat', 'list-ordered', 'split')
PARAMETER_FIELDS = {'label', 'default', 'fixed', 'connectable'}
# `task` components extend an IRAF task; `run` and `flow` components are what a
# GIRAF node does: run as a job, or steer the workflow runner.
COMPONENT_CLASSES = {
    'cursor': 'task', 'image-cursor': 'task', 'value-output': 'task', 'value-input': 'task',
    'ccd-preprocess': 'task', 'calibration-groups': 'task',
    'pass-files': 'run', 'save-files': 'run',
    'value-constant': 'run', 'value-header': 'run', 'value-compute': 'run', 'pset': 'run',
    'foreach': 'flow', 'for': 'flow', 'if': 'flow',
}
RUN_COMPONENTS = ('pass-files', 'save-files', 'value-constant', 'value-header', 'value-compute', 'pset')
# Run components evaluated by GIRAF instead of launched as a job: their value
# outputs (and a pset node's values) feed other nodes' parameters.
VALUE_RUNS = ('value-constant', 'value-header', 'value-compute', 'pset')
PLANNED_COMPONENTS = ('image-cursor', 'value-input', 'ccd-preprocess', 'calibration-groups')
# Flow components make a GIRAF node a container the workflow runner expands
# (giraf/workflow.py): `foreach` runs its members once per item of its one
# input, `for` once per number of a range, `if` routes its one input to a
# true or false lane. Their settings live in the workflow document.
FLOW_COMPONENTS = ('foreach', 'for', 'if')
FLOW_INPUTS = {'foreach': 1, 'for': 0, 'if': 1}
# What a value carries; an IRAF parameter of a matching type can take it.
VALUE_KINDS = ('real', 'int', 'bool', 'string')
COMPONENTS = ('cursor',)
# Toolbar symbols a cursor action may use (HIG: symbols over text).
CURSOR_ICONS = ('check', 'trash', 'sigma', 'save', 'plus', 'minus', 'refresh', 'list', 'eye', 'x')
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
    node = str(data.get('task', '')).startswith(NODE_PREFIX)
    if data.get('version') != 2:
        errors.append('version은 2여야 합니다.')
    errors += [f'{key}: 알 수 없는 필드입니다.' for key in sorted(set(data) - TOP)]
    for key in ('title', 'description'):
        if key in data and not isinstance(data[key], str):
            errors.append(f'{key}: 문자열이어야 합니다.')
    if 'icon' in data and not node:
        errors.append('icon: GIRAF 노드(giraf.)에만 쓸 수 있습니다.')
    elif 'icon' in data and data['icon'] not in NODE_ICONS:
        errors.append(f'icon: {", ".join(NODE_ICONS)} 중 하나여야 합니다.')
    if node and (data.get('parameters') or data.get('groups') or data.get('pinned')):
        errors.append('parameters, groups, pinned: GIRAF 노드에는 IRAF 파라미터가 없습니다.')
    pinned = data.get('pinned', [])
    if not (isinstance(pinned, list) and all(isinstance(k, str) and KEY.fullmatch(k) for k in pinned)
            and len(set(pinned)) == len(pinned)):
        errors.append('pinned: 파라미터 또는 pset.파라미터 이름의 목록이어야 합니다.')
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
                kinds = (NODE_KINDS if node else KINDS) + ((ANY,) if direction == 'inputs' else ())
                if 'kind' in port and port['kind'] not in kinds:
                    errors.append(f'{where}.kind: {", ".join(kinds)} 중 하나여야 합니다.')
                modes = ('pass',) if node else ('single', 'each')
                if port.get('mode', modes[0]) not in modes:
                    errors.append(f'{where}.mode: {" 또는 ".join(modes)}여야 합니다.')
                if node and direction == 'outputs' and not isinstance(port.get('from'), str):
                    errors.append(f'{where}.from: 파일을 넘겨줄 입력 이름이 필요합니다.')
                if 'sources' in port and not (port['sources'] and len(set(port['sources'])) == len(port['sources'])
                                              and all(v in SOURCES for v in port['sources'])):
                    errors.append(f'{where}.sources: {", ".join(SOURCES)} 중 하나 이상의 목록이어야 합니다.')
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
                if 'connectable' in entry and not isinstance(entry['connectable'], bool):
                    errors.append(f'{where}.connectable: true 또는 false여야 합니다.')
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
            kind_class = COMPONENT_CLASSES.get(kind)
            if kind_class and (kind_class == 'task') == node:
                errors.append(f'components: {kind}은 {"IRAF 작업" if kind_class == "task" else "GIRAF 노드(giraf.)"}에만 쓸 수 있습니다.')
            elif kind == 'cursor':
                errors += cursor_errors(item)
            elif kind == 'value-output':
                errors += value_output_errors(item)
            elif kind in RUN_COMPONENTS or kind in FLOW_COMPONENTS:
                if set(item) != {'type'}:
                    errors.append(f'components.{kind}: type 외의 필드는 없습니다.')
            else:
                planned = ' (예정된 구성 요소)' if kind in PLANNED_COMPONENTS else ''
                errors.append(f'components: {kind or "type 없음"}은 아직 지원하지 않습니다{planned}.')
        if sum(isinstance(i, dict) and i.get('type') == 'cursor' for i in components) > 1:
            errors.append('components: cursor는 하나만 둘 수 있습니다.')
        names = [i.get('name') for i in components if isinstance(i, dict) and i.get('type') == 'value-output']
        if len(set(names)) != len(names):
            errors.append('components: value-output 이름은 겹칠 수 없습니다.')
    return errors


def value_output_errors(item):
    """The `value-output` component: numbers a task's run produces, read from
    one output. `column` reads a text table column (header name or 1-based
    index); `keyword` reads a FITS header keyword of each output image.
    """
    errors = []
    extra = set(item) - {'type', 'name', 'kind', 'from', 'column', 'keyword'}
    if extra:
        errors.append(f'components.value-output: {", ".join(sorted(extra))}은 알 수 없는 필드입니다.')
    if not (isinstance(item.get('name'), str) and re.fullmatch(IDENT, item['name'])):
        errors.append('components.value-output.name: 올바른 이름이 필요합니다.')
    if item.get('kind', 'real') not in VALUE_KINDS:
        errors.append(f'components.value-output.kind: {", ".join(VALUE_KINDS)} 중 하나여야 합니다.')
    if not isinstance(item.get('from'), str) or not item['from']:
        errors.append('components.value-output.from: 값을 읽을 출력 이름이 필요합니다.')
    column, keyword = item.get('column'), item.get('keyword')
    if (column is None) == (keyword is None):
        errors.append('components.value-output: column 또는 keyword 중 하나가 필요합니다.')
    elif column is not None and not ((isinstance(column, str) and column.strip())
                                     or (type(column) is int and column >= 1)):
        errors.append('components.value-output.column: 열 이름 또는 1부터 세는 열 번호여야 합니다.')
    elif keyword is not None and not (isinstance(keyword, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,70}', keyword)):
        errors.append('components.value-output.keyword: FITS 헤더 키워드여야 합니다.')
    return errors


def cursor_errors(item):
    """The `cursor` component: names for an interactive task's cursor keys.

    It labels the keys a task already reads in IRAF's cursor mode, so people
    can follow its loop without knowing them; it never adds behavior.
      image:    click (key sent where the image is clicked), count
                ("{n}" = accepted marks), actions [{key, label, icon}],
                finish {label, icon, keys: answers sent to the next requests}
      graphics: title, accept {key, label, icon}, reject {key, label, icon}
    Buttons are symbols (CURSOR_ICONS); the label is their tooltip.
    """
    errors = []
    is_key = lambda v: isinstance(v, str) and len(v) == 1 and not v.isspace()
    is_text = lambda v: isinstance(v, str) and v.strip() != ''
    action = lambda v: (isinstance(v, dict) and {'key', 'label'} <= set(v) <= {'key', 'label', 'icon'} and is_key(v['key'])
                        and is_text(v['label']) and v.get('icon', 'check') in CURSOR_ICONS)
    shape = {'image': {'click', 'count', 'actions', 'finish'}, 'graphics': {'title', 'accept', 'reject'}}
    if set(item) - {'type', *shape}:
        errors.append('components.cursor: image와 graphics만 쓸 수 있습니다.')
    for side, fields in shape.items():
        part = item.get(side, {})
        if not isinstance(part, dict) or set(part) - fields:
            errors.append(f'components.cursor.{side}: {", ".join(sorted(fields))}만 쓸 수 있습니다.')
            continue
        for field in ('count', 'title'):
            if field in part and not is_text(part[field]):
                errors.append(f'components.cursor.{side}.{field}: 문자열이어야 합니다.')
        if 'click' in part and not is_key(part['click']):
            errors.append(f'components.cursor.{side}.click: 키 한 글자여야 합니다.')
        for field in ('accept', 'reject'):
            if field in part and not action(part[field]):
                errors.append(f'components.cursor.{side}.{field}: {{key, label}}이어야 합니다.')
        if 'actions' in part and not (isinstance(part['actions'], list) and all(map(action, part['actions']))):
            errors.append(f'components.cursor.{side}.actions: {{key, label}}의 목록이어야 합니다.')
        finish = part.get('finish')
        if finish is not None and not (isinstance(finish, dict) and {'label', 'keys'} <= set(finish) <= {'label', 'keys', 'icon'}
                                       and finish.get('icon', 'check') in CURSOR_ICONS and is_text(finish['label'])
                                       and isinstance(finish['keys'], list) and finish['keys'] and all(map(is_key, finish['keys']))):
            errors.append(f'components.cursor.{side}.finish: {{label, keys}}이어야 합니다.')
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
    presentation = dict(parameters={}, groups=None, components=None, pinned=None)
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
        if 'components' in patch:
            presentation['components'] = patch['components']
            provenance['components'] = name
        if 'pinned' in patch:
            presentation['pinned'] = patch['pinned']
            provenance['pinned'] = name
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
        if 'connectable' in entry: p['connectable'] = entry['connectable']
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
            if 'connectable' in entry: p['connectable'] = entry['connectable']
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
    cursor = next((c for c in presentation.get('components') or [] if c.get('type') == 'cursor'), None)
    if cursor:
        spec['cursor'] = {k: v for k, v in cursor.items() if k != 'type'}
    outputs = {s['name'] for s in spec['outputs']}
    for item in presentation.get('components') or []:
        if item.get('type') == 'value-output' and item.get('from') not in outputs:
            warn(f'components.value-output.{item.get("name")}: {item.get("from")} 출력이 없습니다.')
    values = [{'kind': 'real', **{k: v for k, v in c.items() if k != 'type'}}
              for c in presentation.get('components') or [] if c.get('type') == 'value-output' and c.get('from') in outputs]
    if values:
        spec['values'] = values
    if presentation.get('pinned') is not None:
        shown = {p['name'] for p in spec['parameters']} | {
            g['name'] + '.' + p['name'] for g in spec['parameterSets'] for p in g['parameters']}
        for key in presentation['pinned']:
            if key not in shown:
                warn(f'pinned: {key}는 노드에 고정할 수 없는 파라미터입니다.')
        spec['pinned'] = [k for k in presentation['pinned'] if k in shown]
    spec['schemaLayers'] = [dict(layer=l['layer'], source=l['source']) for l in layers]
    spec['schemaProvenance'] = provenance
    spec['schemaIssues'] = issues
    return spec


def node_definition(task, layers):
    """Build a GIRAF node (`giraf.` namespace) from its schema layers.

    Layers patch each other as they patch an IRAF task: ports by name, `null`
    removes one, components replace the list. What the node does comes from its
    one run or flow component, never from code keyed on its name.
    """
    import hashlib
    issues, provenance, files = [], {}, {}
    ports = {'inputs': {}, 'outputs': {}}
    shown = dict(title=task[len(NODE_PREFIX):], description='', icon=None)
    components = []
    error = lambda message: issues.append(dict(severity='error', message=message))
    for layer in layers:
        files[layer['source']] = layer['hash']
        if layer['errors']:
            for message in layer['errors']:
                error(f'{Path(layer["source"]).name}: {message}')
            continue
        patch, name = layer['patch'], layer['layer']
        for key in shown:
            if key in patch:
                shown[key] = patch[key]
                provenance[key] = name
        for direction in ports:
            for role, port in patch.get(direction, {}).items():
                where = f'{direction}.{role}'
                provenance[where] = name
                if port is None:
                    ports[direction].pop(role, None)
                elif role not in ports[direction] and 'kind' not in port:
                    error(f'{where}: 새 포트에는 kind가 필요합니다.')
                else:
                    ports[direction][role] = {**ports[direction].get(role, {'name': role}), **port}
        if 'components' in patch:
            components = patch['components']
            provenance['components'] = name
    actions = [c['type'] for c in components if COMPONENT_CLASSES.get(c.get('type')) in ('run', 'flow')]
    if len(actions) != 1:
        error('components: 실행 또는 흐름 구성 요소가 하나 필요합니다.')
    run = actions[0] if len(actions) == 1 else None
    inputs = [{'label': p['name'], 'multiple': True, 'required': False, **p} for p in ports['inputs'].values()]
    # A pass output exists only while its input holds files of its kind.
    outputs = [{'label': p['name'], 'default': '', 'optional': True, **p} for p in ports['outputs'].values()]
    for slot in outputs:
        if slot['from'] not in ports['inputs']:
            error(f'outputs.{slot["name"]}.from: {slot["from"]} 입력이 없습니다.')
    if run == 'save-files' and outputs:
        error('outputs: save-files 노드는 출력이 없습니다.')
    if run == 'pass-files' and not outputs:
        error('outputs: pass-files 노드에는 넘겨줄 출력이 필요합니다.')
    if run in FLOW_COMPONENTS:
        # A container's outputs are its boundary (results), not schema ports.
        if outputs:
            error(f'outputs: {run} 노드의 출력은 컨테이너 경계에서 정합니다.')
        if len(inputs) != FLOW_INPUTS[run]:
            error(f'inputs: {run} 노드에는 입력이 {FLOW_INPUTS[run]}개 필요합니다.')
    fingerprint = hashlib.sha256(json.dumps(dict(files=files, inputs=inputs, outputs=outputs, run=run),
                                            sort_keys=True).encode()).hexdigest()
    reason = ' '.join(dict.fromkeys(i['message'] for i in issues))
    return dict(name=task, package=NODE_PREFIX.rstrip('.'), taskName=shown['title'], title=shown['title'],
                description=shown['description'], icon=shown['icon'], run=run, adapter='generic',
                inputs=inputs, outputs=outputs, output=None, kind=ANY, parameters=[], allParameters=[],
                parameterSets=[], fixed={}, schemaFiles=files, schemaFingerprint=fingerprint,
                schemaLayers=[dict(layer=l['layer'], source=l['source']) for l in layers],
                schemaProvenance=provenance, schemaIssues=issues, runnable=not issues, reason=reason)
