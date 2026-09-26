"""Validate a schema-driven request and freeze its execution manifest."""
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path

from ..jobs import ROOT
from ..task_discovery import file_hash
from ..task_capabilities import parameter_number
from ..products import product_name
from .inputs import resolve_generic_inputs, validate_cursor_records, alignment_pairs
from .preview import preview_generic


def checked_values(parameters, supplied):
    allowed = {p['name']: p for p in parameters}
    if not isinstance(supplied, dict) or set(supplied) - set(allowed):
        raise ValueError('알 수 없는 파라미터가 있습니다.')
    values = {}
    for name, p in allowed.items():
        value = supplied.get(name, p['default'])
        if isinstance(value, str) and value.startswith(')') and value == p.get('indirect'):
            continue
        if name not in supplied and value == '' and p.get('hasDefault') is False and 'h' in p.get('mode', ''):
            continue
        if p['type'] == 'b':
            if value not in (True, False, 'yes', 'no'):
                raise ValueError(f'{name}: yes 또는 no를 선택해 주세요.')
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
                    raise ValueError(f'{name}: 유효한 수치와 범위를 입력해 주세요.') from None
        else:
            value = str(value)
            if len(value) > 20000 or any(ch in value for ch in '\n\r\x00'):
                raise ValueError(f'{name}: 한 줄의 값을 입력해 주세요.')
        if p['choices'] and str(value) not in p['choices']:
            raise ValueError(f'{name}: 허용된 값을 선택해 주세요.')
        values[name] = value
    return values



def validate_generic(spec, payload, resolve, *, diagnostics=False, pending_roles=frozenset()):
    if not spec['runnable']: raise ValueError(spec['reason'])
    backend = payload.get('backend', 'cl')
    if backend not in ('cl', 'pyraf'): raise ValueError('CL 또는 PyRAF를 선택해 주세요.')
    if payload.get('filePolicy', {}).get('mode', 'copy') != 'copy':
        raise ValueError('범용 작업은 사본에서 실행합니다. 파일 처리를 사본으로 선택해 주세요.')
    directory = str(Path(payload.get('workingDirectory') or ROOT).expanduser().resolve())
    # Retired empty controls may now be managed output destinations.
    output_roles = {s['name'] for s in spec['outputs']}
    supplied = {k: v for k, v in payload.get('parameters', {}).items()
                if k not in output_roles or v != ''}
    # A file can replace a numeric operand, so do not require an unused scalar.
    scalar_names = {s['name'] for s in spec['inputs'] if s.get('scalar')}
    ordinary = [p for p in spec['parameters'] if p['name'] not in scalar_names]
    if set(supplied) - {p['name'] for p in spec['parameters']}: raise ValueError('알 수 없는 파라미터가 있습니다.')
    params = checked_values(ordinary, {k: v for k, v in supplied.items() if k not in scalar_names})
    spec = deepcopy(spec)
    for slot in spec['outputs']:
        if slot.get('eachWhen'):
            slot['mode'] = 'each' if params.get(slot['eachWhen']) == 'yes' else 'single'
    supplied_sets = payload.get('parameterSets', {})
    if set(supplied_sets) - {s['name'] for s in spec['parameterSets']}: raise ValueError('알 수 없는 파라미터 세트입니다.')
    sets = {s['name']: checked_values(s['parameters'], supplied_sets.get(s['name'], {})) for s in spec['parameterSets']}
    for values in [params, *sets.values()]:
        # Interactive display/cursor integration needs a dedicated adapter.
        for key in ('interactive', 'verify', 'update'):
            if values.get(key) == 'yes' and spec.get('fixed', {}).get(key) != 'no':
                raise ValueError(f'{key}: 범용 실행에서는 no를 선택해 주세요.')
    cursor_commands = payload.get('cursorCommands', {})
    cursor_roles = {s['name'] for s in spec['inputs'] if s.get('valueType') == 'cursor'}
    if not isinstance(cursor_commands, dict) or set(cursor_commands) - cursor_roles:
        raise ValueError('알 수 없는 커서 입력입니다.')
    for name, records in cursor_commands.items():
        if not isinstance(records, str) or len(records) > 1_000_000 or '\x00' in records:
            raise ValueError(f'{name}: 올바른 커서 명령을 입력해 주세요.')
        validate_cursor_records(records, name)
    text_inputs = payload.get('textInputs', {})
    allowed_text = {'coords', 'shifts'} if spec['name'] == 'images.immatch.imalign' else set()
    if not isinstance(text_inputs, dict) or set(text_inputs) - allowed_text:
        raise ValueError('지원하지 않는 직접 텍스트 입력입니다.')
    pairs = {name: alignment_pairs(value, name) for name, value in text_inputs.items()}
    inputs, sources, input_lists, supplied_inputs, expressions, scalar_values = resolve_generic_inputs(
        spec, payload, supplied, directory, resolve, hash_file=file_hash,
        diagnostics=diagnostics, pending_roles=pending_roles)
    params.update(scalar_values)
    if pairs.get('shifts') and len(pairs['shifts']) != len(inputs.get('input', [])):
        raise ValueError('shifts: 입력 영상 순서대로 영상마다 한 행을 입력해 주세요.')
    warnings = []
    binding = payload.get('alignmentBinding')
    if binding and any(text_inputs.get(k, '').strip() for k in ('coords', 'shifts')):
        if not isinstance(binding, dict) or binding.get('reference') != inputs.get('reference') or (text_inputs.get('shifts', '').strip() and binding.get('input') != inputs.get('input')):
            warnings.append('영상 선택 또는 순서가 변경되었습니다. 기준별 좌표와 이동량을 다시 확인해 주세요.')
    provided_outputs = payload.get('outputs', {})
    if set(provided_outputs) - {s['name'] for s in spec['outputs']}: raise ValueError('알 수 없는 출력 역할입니다.')
    outputs = {}
    for slot in spec['outputs']:
        name = str(provided_outputs.get(slot['name'], slot['default']))
        if slot.get('optional') and not name:
            outputs[slot['name']] = ''
            continue
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
    active_each = any(slot['mode'] == 'each' and outputs.get(slot['name']) for slot in spec['outputs'])
    if active_each and spec['inputs']:
        count = len(inputs.get(spec['inputs'][0]['name'], []))
        for slot in spec['inputs'][1:]:
            if slot['multiple'] and slot['name'] not in pending_roles and spec['inputs'][0]['name'] not in pending_roles and len(inputs[slot['name']]) not in (0, 1, count):
                raise ValueError(f'{slot["name"]}: 입력 파일은 한 개 또는 주 입력과 같은 {count}개여야 합니다.')
    previews = preview_generic(m)
    labels = [r['output'] for r in previews]
    if diagnostics:
        return m
    m['filePlan'] = dict(mode='copy', destructive=False, backup=True, targets=[dict(path=r['path'], sha256=r['sha256'], role='input') for r in sources.values()],
                         output=', '.join(labels), description='선언된 입력 사본과 독립된 파라미터로 실행합니다.', collision='기존 결과를 덮어쓰지 않습니다.')
    m['filePlan']['token'] = hashlib.sha256(json.dumps(m, sort_keys=True).encode()).hexdigest()
    return m

