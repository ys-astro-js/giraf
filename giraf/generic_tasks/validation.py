"""Validate a schema-driven request and freeze its execution manifest."""
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path

from ..jobs import DATA
from ..task_discovery import file_hash
from ..task_capabilities import parameter_number
from ..products import product_name
from .inputs import accepts_source, resolve_generic_inputs, validate_cursor_records, alignment_pairs
from .preview import preview_generic
from ..field_issues import FieldError, FieldWarning, Issues


def checked_values(parameters, supplied, prefix='', issues=None):
    """Checked values; a problem names its field as `prefix + name`. With
    collecting `issues` every parameter is checked and a bad one is left out."""
    issues = issues or Issues()
    allowed = {p['name']: p for p in parameters}
    if not isinstance(supplied, dict) or set(supplied) - set(allowed):
        issues.error(ValueError('알 수 없는 파라미터가 있습니다.'))
        supplied = {k: v for k, v in supplied.items() if k in allowed} if isinstance(supplied, dict) else {}
    values = {}
    for name, p in allowed.items():
        checked = SKIP
        with issues.check():
            checked = checked_value(name, p, supplied, prefix)
        if checked is not SKIP:
            values[name] = checked
    return values


SKIP = object()


def checked_value(name, p, supplied, prefix):
    """One parameter's checked value, or SKIP when it stays unset."""
    value = supplied.get(name, p['default'])
    if isinstance(value, str) and value.startswith(')') and value == p.get('indirect'):
        return SKIP
    if name not in supplied and value == '' and p.get('hasDefault') is False and 'h' in p.get('mode', ''):
        return SKIP
    # An untouched numeric field with no IRAF default stays unset (display z1/z2).
    if value == '' and p['type'] in ('i', 'r', 'd') and p['default'] in ('', None):
        return SKIP
    if p['type'] == 'b':
        if value not in (True, False, 'yes', 'no'):
            raise FieldError(prefix + name, f'{name}: yes 또는 no를 선택해 주세요.')
        value = 'yes' if value in (True, 'yes') else 'no'
    elif p['type'] in ('i', 'r', 'd'):
        if str(value).upper() == 'INDEF': value = 'INDEF'
        else:
            try:
                number = parameter_number(value)
                if not math.isfinite(number) or (p['type'] == 'i' and int(number) != number): raise ValueError()
                value = int(number) if p['type'] == 'i' else number
                if p['min'] != '' and value < parameter_number(p['min']): raise ValueError()
                if p['max'] != '' and value > parameter_number(p['max']): raise ValueError()
            except (TypeError, ValueError, OverflowError):
                raise FieldError(prefix + name, f'{name}: 유효한 수치와 범위를 입력해 주세요.') from None
    else:
        value = str(value)
        if len(value) > 20000 or any(ch in value for ch in '\n\r\x00'):
            raise FieldError(prefix + name, f'{name}: 한 줄의 값을 입력해 주세요.')
    if p['choices'] and str(value) not in p['choices']:
        raise FieldError(prefix + name, f'{name}: 허용된 값을 선택해 주세요.')
    return value


def same_value(a, b):
    a, b = ('yes' if v is True else 'no' if v is False else v for v in (a, b))
    try:
        return float(a) == float(b)
    except (TypeError, ValueError):
        return str(a) == str(b)


def without_fixed(supplied, fixed, prefix, warnings):
    """Schema-fixed values win over values stored in an existing node."""
    for name, value in fixed.items():
        if name in supplied and not same_value(supplied[name], value):
            warnings.append(FieldWarning(prefix + name, f'{prefix}{name}: 노드 값 {supplied[name]} 대신 스키마 고정값 {value}을 사용합니다.'))
    return {k: v for k, v in supplied.items() if k not in fixed}


def interactive_run(spec, params, payload):
    """Does the run read the cursor from the person running it?

    A task with IRAF's `interactive` parameter decides by it. A task without
    one reads its cursor parameter (`*imcur`) interactively when its node
    schema names the cursor keys (a `cursor` component) and no recorded
    commands or command file are given for it (daoedit).
    """
    if any(p['name'] == 'interactive' for p in spec.get('allParameters', spec['parameters'])):
        return params.get('interactive') == 'yes'
    if not spec.get('cursor'):
        return False
    roles = [s['name'] for s in spec['inputs'] if s.get('valueType') == 'cursor']
    commands, inputs, expressions = (payload.get(k) or {} for k in ('cursorCommands', 'inputs', 'expressions'))
    return not any(str(commands.get(r, '')).strip() or inputs.get(r) or str(expressions.get(r, '')).strip() for r in roles)


def edits_inputs(spec):
    """Image inputs a task edits and passes on: the `from` of its `pass` outputs."""
    images = {s['name'] for s in spec['inputs'] if s.get('kind') == 'image'}
    return [o['from'] for o in spec['outputs'] if o.get('mode') == 'pass' and o.get('from') in images] if not spec.get('run') else []


def validate_generic(spec, payload, resolve, *, diagnostics=False, pending_roles=frozenset(), issues=None):
    """The run's manifest. A run refuses on the first problem; collecting
    `issues` (giraf/field_issues.py) check every input and parameter first."""
    issues = issues or Issues()
    if not spec['runnable']: raise ValueError(spec['reason'])
    from ..node_schema import VALUE_RUNS
    if spec.get('run') in VALUE_RUNS:
        raise ValueError('값과 pset 노드는 연결한 작업을 실행할 때 함께 계산합니다.')
    backend = payload.get('backend', 'cl')
    with issues.check():
        if backend not in ('cl', 'pyraf'): raise ValueError('CL 또는 PyRAF를 선택해 주세요.')
    with issues.check():
        if payload.get('filePolicy', {}).get('mode', 'copy') != 'copy':
            raise ValueError('범용 작업은 사본에서 실행합니다. 파일 처리를 사본으로 선택해 주세요.')
    directory = str(Path(payload.get('workingDirectory') or DATA).expanduser().resolve())
    # Retired empty controls may now be managed output destinations.
    output_roles = {s['name'] for s in spec['outputs']}
    schema_warnings = issues.warnings
    supplied = without_fixed({k: v for k, v in payload.get('parameters', {}).items()
                              if k not in output_roles or v != ''}, spec.get('fixed', {}), '', schema_warnings)
    # A file can replace a numeric operand, so do not require an unused scalar.
    scalar_names = {s['name'] for s in spec['inputs'] if s.get('scalar')}
    ordinary = [p for p in spec['parameters'] if p['name'] not in scalar_names]
    with issues.check():
        if set(supplied) - {p['name'] for p in spec['parameters']}: raise ValueError('알 수 없는 파라미터가 있습니다.')
    params = checked_values(ordinary, {k: v for k, v in supplied.items() if k not in scalar_names}, issues=issues)
    spec = deepcopy(spec)
    for slot in spec['outputs']:
        if slot.get('eachWhen'):
            slot['mode'] = 'each' if params.get(slot['eachWhen']) == 'yes' else 'single'
    supplied_sets = payload.get('parameterSets', {})
    with issues.check():
        if set(supplied_sets) - {s['name'] for s in spec['parameterSets']}: raise ValueError('알 수 없는 파라미터 세트입니다.')
    sets = {s['name']: {**checked_values(s['parameters'], without_fixed(
                supplied_sets.get(s['name'], {}), s.get('fixed', {}), s['name'] + '.', schema_warnings), s['name'] + '.', issues), **s.get('fixed', {})}
            for s in spec['parameterSets']}
    # The task's own cursor loop runs through IRAF's text cursor mode; parameter
    # sets and verify/update queries still have no interactive adapter.
    cursor_commands = payload.get('cursorCommands', {})
    interactive = interactive_run(spec, params, payload)
    # A task that passes its edited inputs on (a `pass` output) writes to the
    # copies it is given, so it may update them (hedit update=yes).
    edits = edits_inputs(spec)
    for prefix, values in [('', params), *((name + '.', held) for name, held in sets.items())]:
        for key in ('verify', 'update') if values is params else ('interactive', 'verify', 'update'):
            if key == 'update' and values is params and edits:
                continue
            if values.get(key) == 'yes' and spec.get('fixed', {}).get(key) != 'no':
                issues.error(FieldError(prefix + key, f'{key}: 범용 실행에서는 no를 선택해 주세요.'))
    if interactive and backend != 'cl':
        backend = 'cl'
        issues.warn(FieldWarning('interactive', 'interactive: 대화형 실행은 IRAF CL에서 진행합니다.'))
    cursor_roles = {s['name'] for s in spec['inputs'] if s.get('valueType') == 'cursor' and accepts_source(s, 'cursor')}
    if not isinstance(cursor_commands, dict) or set(cursor_commands) - cursor_roles:
        raise ValueError('알 수 없는 커서 입력입니다.')
    for name, records in cursor_commands.items():
        with issues.check(name):
            if not isinstance(records, str) or len(records) > 1_000_000 or '\x00' in records:
                raise FieldError(name, f'{name}: 올바른 커서 명령을 입력해 주세요.')
            validate_cursor_records(records, name)
    text_inputs = payload.get('textInputs', {})
    allowed_text = {'coords', 'shifts'} if spec['name'] == 'images.immatch.imalign' else set()
    allowed_text = {s['name'] for s in spec['inputs'] if 'text' in s.get('sources', ())} | {
        name for name in allowed_text if accepts_source(next((s for s in spec['inputs'] if s['name'] == name), {}), 'text')}
    if not isinstance(text_inputs, dict) or set(text_inputs) - allowed_text:
        raise ValueError('지원하지 않는 직접 텍스트 입력입니다.')
    pairs = {}
    for name, value in text_inputs.items():
        with issues.check(name):
            pairs[name] = alignment_pairs(value, name)
    inputs, sources, input_lists, supplied_inputs, expressions, scalar_values = resolve_generic_inputs(
        spec, payload, supplied, directory, resolve, hash_file=file_hash,
        diagnostics=diagnostics, pending_roles=pending_roles, issues=issues)
    params.update(scalar_values)
    # Checks of an input's files skip an input that could not be read.
    if pairs.get('shifts') and not issues.failed('input') and len(pairs['shifts']) != len(inputs.get('input', [])):
        issues.error(FieldError('shifts', 'shifts: 입력 영상 순서대로 영상마다 한 행을 입력해 주세요.'))
    warnings = issues.warnings
    binding = payload.get('alignmentBinding')
    if binding and not (issues.failed('reference') or issues.failed('input')) and any(text_inputs.get(k, '').strip() for k in ('coords', 'shifts')):
        if not isinstance(binding, dict) or binding.get('reference') != inputs.get('reference') or (text_inputs.get('shifts', '').strip() and binding.get('input') != inputs.get('input')):
            issues.warn('영상 선택 또는 순서가 변경되었습니다. 기준별 좌표와 이동량을 다시 확인해 주세요.')
    provided_outputs = payload.get('outputs', {})
    with issues.check():
        if set(provided_outputs) - {s['name'] for s in spec['outputs']}: raise ValueError('알 수 없는 출력 역할입니다.')
    outputs = {}
    for slot in spec['outputs']:
        name = str(provided_outputs.get(slot['name'], slot['default']))
        if slot.get('mode') == 'pass':
            # A pass-through output carries its input files; it has no name to check.
            outputs[slot['name']] = '*' if name else ''
            continue
        if slot.get('optional') and not name:
            outputs[slot['name']] = ''
            continue
        with issues.check():
            product_name(name)
            if len(name) > 180 or name.startswith('@'):
                raise ValueError(f'{slot["name"]}: 경로 대신 결과 파일 이름 또는 접두사를 입력해 주세요.')
        outputs[slot['name']] = name
    m = dict(operation='task', adapter='generic', task=spec['name'], name=spec['name'], backend=backend,
             definition=deepcopy(spec), mapping=payload.get('mapping', {}), parameters=params, parameterSets=sets, inputs=inputs, outputs=outputs,
             output={'name': next(iter(outputs.values()), '')}, rows=list(sources.values()), expressions=expressions, cursorCommands=cursor_commands, textInputs=text_inputs, alignmentBinding=binding, warnings=warnings,
             inputLists=list(input_lists.values()), workingDirectory=directory, filePolicy=dict(mode='copy', backup=True), instanceId=payload.get('instanceId'),
             settings=dict(task=spec['name'], backend=backend, **params))
    if input_lists: m['inputSelections']=deepcopy(supplied_inputs)
    if spec.get('run') == 'save-files':
        from ..file_nodes import checked_destination
        with issues.check():
            m['destination'] = checked_destination(payload.get('destination'), directory)
    if interactive:
        from ..cursor_keys import cursor_keys
        image = next((inputs[slot['name']][0] for slot in spec['inputs'] if slot['kind'] == 'image' and inputs.get(slot['name'])), None)
        m.update(interactive=True, cursorKeys=cursor_keys(spec), cursorImage=image, cursor=spec.get('cursor'))
    active_each = any(slot['mode'] == 'each' and outputs.get(slot['name']) for slot in spec['outputs'])
    if active_each and spec['inputs']:
        count = len(inputs.get(spec['inputs'][0]['name'], []))
        for slot in spec['inputs'][1:]:
            if slot['multiple'] and slot['name'] not in pending_roles and spec['inputs'][0]['name'] not in pending_roles \
                    and slot['name'] in inputs and spec['inputs'][0]['name'] in inputs and len(inputs[slot['name']]) not in (0, 1, count):
                issues.error(FieldError(slot['name'], f'{slot["name"]}: 입력 파일은 한 개 또는 주 입력과 같은 {count}개여야 합니다.'))
    # The output names need every input's files.
    issues.halt()
    previews = preview_generic(m)
    labels = [r['output'] for r in previews]
    if diagnostics:
        return m
    m['filePlan'] = dict(mode='copy', destructive=False, backup=True, targets=[dict(path=r['path'], sha256=r['sha256'], role='input') for r in sources.values()],
                         output=', '.join(labels), description='선언된 입력 사본과 독립된 파라미터로 실행합니다.', collision='기존 결과를 덮어쓰지 않습니다.')
    if m.get('destination'):
        overwrite = m['destination']['conflict'] == 'overwrite'
        m['filePlan'].update(description=f"{m['destination']['folder']}에 파일을 저장합니다.",
                             collision='같은 이름의 파일을 덮어씁니다.' if overwrite else '같은 이름이 있으면 번호를 붙여 저장합니다.')
    m['filePlan']['token'] = hashlib.sha256(json.dumps(m, sort_keys=True).encode()).hexdigest()
    return m

