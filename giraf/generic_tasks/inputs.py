"""Validate declared input selections, cursor records, and alignment tables."""
from copy import deepcopy
import hashlib
import io
import math
from pathlib import Path
import re
from ..task_capabilities import parameter_number
from ..task_expressions import resolve_expression, inspect_expression


def validate_cursor_file(path, name):
    """Cursor replay records are x y wcs key [command], not coordinate tables."""
    validate_cursor_records(path.read_text(), name)


def validate_cursor_records(records, name):
    with io.StringIO(records) as stream:
        for index, line in enumerate(stream, 1):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            fields = line.split(None, 4)
            try:
                # CLGCUR also accepts a bare key plus optional command.
                key_pattern = r'(?:[^\s]|\\[0-7]{1,3}|\\[btnrf])'
                if not re.match(r'[+\-.0-9]', fields[0]) and fields[0] != 'INDEF':
                    if not re.fullmatch(key_pattern, fields[0]):
                        raise ValueError()
                    continue
                if len(fields) < 4 or not re.fullmatch(key_pattern, fields[3]):
                    raise ValueError()
                for value in fields[:2]:
                    if value.upper() != 'INDEF' and not math.isfinite(parameter_number(value)):
                        raise ValueError()
                int(fields[2])
            except ValueError:
                raise ValueError(f'{name}: {index}행은 x y wcs key [command] 형식의 cursor record가 필요합니다.') from None


def alignment_pairs(records, name):
    if not isinstance(records, str) or len(records) > 1_000_000 or '\x00' in records:
        raise ValueError(f'{name}: 두 열의 수치를 입력해 주세요.')
    pairs = []
    for index, line in enumerate(records.splitlines(), 1):
        if not line.strip(): continue
        try:
            pair = [float(v) for v in line.split()]
            if len(pair) != 2 or not all(math.isfinite(v) for v in pair): raise ValueError()
            if name == 'coords' and min(pair) < 1: raise ValueError()
        except ValueError:
            raise ValueError(f'{name}: {index}행에 유효한 X Y 두 값을 입력해 주세요.') from None
        pairs.append(pair)
    return pairs


def resolve_generic_inputs(spec, payload, supplied, directory, resolve, *, hash_file, diagnostics, pending_roles):
    cursor_commands = payload.get('cursorCommands', {})
    text_inputs = payload.get('textInputs', {})
    output_roles = {slot['name'] for slot in spec['outputs']}
    inputs = {}; sources = {}; input_lists = {}
    supplied_inputs = payload.get('inputs', {})
    expressions = payload.get('expressions', {})
    roles = {s['name'] for s in spec['inputs']}
    # A catalog reload can turn an inferred file port back into a parameter.
    # Old drafts retain empty selections for it; discard only those placeholders.
    # Keep rejecting unknown roles or actual file selections rather than losing data.
    parameter_roles = ({p['name'] for p in spec['parameters']} | output_roles) - roles
    supplied_inputs = {k: v for k, v in supplied_inputs.items()
                       if k not in parameter_roles or v != []}
    expressions = {k: v for k, v in expressions.items()
                   if k not in parameter_roles or v != ''}
    if set(supplied_inputs) - roles or set(expressions) - roles: raise ValueError('지원하지 않는 입력 역할입니다.')
    scalar_values = {}
    for slot in spec['inputs']:
        name = slot['name']; ids = supplied_inputs.get(name, [])
        if not isinstance(ids, list) or any(not isinstance(i, str) for i in ids): raise ValueError(f'{name}: 파일 목록을 선택해 주세요.')
        expanded = {}
        expr = expressions.get(name, '')
        if (cursor_commands.get(name, '').strip() or text_inputs.get(name, '').strip()) and (ids or expr):
            raise ValueError(f'{name}: 직접 입력과 파일/노드 연결 중 하나를 선택해 주세요.')
        if expr:
            if slot['kind'] == 'image':
                rows = (inspect_expression if diagnostics else resolve_expression)(expr, directory)
            else:
                path = Path(expr).expanduser(); path = path if path.is_absolute() else Path(directory) / path
                rows = [dict(id=hashlib.sha256(str(path.resolve()).encode()).hexdigest()[:20], name=path.name, label=path.name, path=str(path.resolve()), asset=slot['kind'])]
            ids = [r['id'] for r in rows]; expanded = {r['id']: r for r in rows}
        from ..image_lists import expand_image_selection, accepts_asset
        selection_slot = slot
        selected, list_sources = expand_image_selection(selection_slot, ids, lambda id: expanded[id] if id in expanded else resolve(id), directory, inspection=diagnostics)
        ids = [r['id'] for r in selected]
        expanded.update({r['id']: r for r in selected})
        input_lists.update({r['path']: r for r in list_sources})
        if slot['required'] and not ids and name not in pending_roles and not cursor_commands.get(name, '').strip() and not text_inputs.get(name, '').strip(): raise ValueError(f'{slot["label"]}: 입력 파일을 선택해 주세요.')
        if not slot['multiple'] and len(ids) > 1: raise ValueError(f'{name}: 파일 한 개를 선택해 주세요.')
        if slot.get('scalar') and not ids and name not in pending_roles:
            try:
                value = float(supplied.get(name, ''))
                if not math.isfinite(value): raise ValueError()
                scalar_values[name] = str(value)
            except (TypeError, ValueError):
                raise ValueError(f'{name}: 파일 또는 유한한 수치 상수를 지정해 주세요.') from None
        inputs[name] = ids
        for id in ids:
            row = deepcopy(expanded[id] if id in expanded else resolve(id))
            path = Path(row['path'])
            if not path.is_file(): raise ValueError(f'{name}: {row.get("label") or path.name}: 입력 파일이 없습니다.')
            if diagnostics and row.get('error'):
                raise ValueError(f'{name}: {row["error"]}')
            if not accepts_asset(slot['kind'], row.get('asset', 'image')): raise ValueError(f'{name}: {slot["kind"]} 파일을 선택해 주세요.')
            if slot.get('valueType') == 'cursor':
                validate_cursor_file(path, name)
            if not diagnostics: row['sha256'] = hash_file(path)
            sources[id] = row
    return inputs, sources, input_lists, supplied_inputs, expressions, scalar_values
