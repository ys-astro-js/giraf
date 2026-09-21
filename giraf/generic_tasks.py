"""Schema-driven IRAF validation and isolated execution, independent of CCD.

The server freezes schemas into the manifest. Only declared file roles are
staged; arbitrary expressions in numeric alternative slots are rejected.
"""
from copy import deepcopy
import io
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import sys

from .jobs import ROOT, atomic_json
from .task_discovery import file_hash
from .task_capabilities import parameter_number
from .task_schema import file_extension
from .task_expressions import resolve_expression
from .task_session import run_process, Cancelled


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


def validate_generic(spec, payload, resolve):
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
    for slot in spec['inputs']:
        name = slot['name']; ids = supplied_inputs.get(name, [])
        if not isinstance(ids, list) or any(not isinstance(i, str) for i in ids): raise ValueError(f'{name}: 파일 목록을 선택해 주세요.')
        expanded = {}
        expr = expressions.get(name, '')
        if (cursor_commands.get(name, '').strip() or text_inputs.get(name, '').strip()) and (ids or expr):
            raise ValueError(f'{name}: 직접 입력과 파일/노드 연결 중 하나를 선택해 주세요.')
        if expr:
            if slot['kind'] == 'image':
                rows = resolve_expression(expr, directory)
            else:
                path = Path(expr).expanduser(); path = path if path.is_absolute() else Path(directory) / path
                rows = [dict(id=hashlib.sha256(str(path.resolve()).encode()).hexdigest()[:20], name=path.name, label=path.name, path=str(path.resolve()), asset=slot['kind'])]
            ids = [r['id'] for r in rows]; expanded = {r['id']: r for r in rows}
        from .image_lists import expand_image_selection, accepts_asset
        selection_slot = slot
        selected, list_sources = expand_image_selection(selection_slot, ids, lambda id: expanded[id] if id in expanded else resolve(id), directory)
        ids = [r['id'] for r in selected]
        expanded.update({r['id']: r for r in selected})
        input_lists.update({r['path']: r for r in list_sources})
        if slot['required'] and not ids and not cursor_commands.get(name, '').strip() and not text_inputs.get(name, '').strip(): raise ValueError(f'{slot["label"]}: 입력 파일을 선택해 주세요.')
        if not slot['multiple'] and len(ids) > 1: raise ValueError(f'{name}: 파일 한 개를 선택해 주세요.')
        if slot.get('scalar') and not ids:
            try:
                value = float(supplied.get(name, ''))
                if not math.isfinite(value): raise ValueError()
                params[name] = str(value)
            except (TypeError, ValueError):
                raise ValueError(f'{name}: 파일 또는 유한한 수치 상수를 지정해 주세요.') from None
        inputs[name] = ids
        for id in ids:
            row = deepcopy(expanded[id] if id in expanded else resolve(id))
            path = Path(row['path'])
            if not path.is_file(): raise ValueError(f'{name}: 입력 파일이 없습니다.')
            if not accepts_asset(slot['kind'], row.get('asset', 'image')): raise ValueError(f'{name}: {slot["kind"]} 파일을 선택해 주세요.')
            if slot.get('valueType') == 'cursor':
                validate_cursor_file(path, name)
            row['sha256'] = file_hash(path); sources[id] = row
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
        name = str(provided_outputs.get(slot['name'], slot['default'])).strip()
        if slot.get('optional') and not name:
            outputs[slot['name']] = ''
            continue
        if not name or name in ('.', '..') or any(c in name for c in '/\\\n\r\x00') or len(name) > 180 or name.startswith('@'):
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
            if slot['multiple'] and len(inputs[slot['name']]) not in (0, 1, count):
                raise ValueError(f'{slot["name"]}: 입력 파일은 한 개 또는 주 입력과 같은 {count}개여야 합니다.')
    previews = preview_generic(m)
    labels = [r['output'] for r in previews]
    if len(labels) != len(set(labels)): raise ValueError('출력 파일 이름이 중복됩니다. 서로 다른 이름을 지정해 주세요.')
    m['filePlan'] = dict(mode='copy', destructive=False, backup=True, targets=[dict(path=r['path'], sha256=r['sha256'], role='input') for r in sources.values()],
                         output=', '.join(labels), description='선언된 입력 사본과 독립된 파라미터로 실행합니다.', collision='기존 결과를 덮어쓰지 않습니다.')
    m['filePlan']['token'] = hashlib.sha256(json.dumps(m, sort_keys=True).encode()).hexdigest()
    return m


def preview_generic(manifest):
    spec = manifest['definition']; rows = {r['id']: r for r in manifest['rows']}
    main = manifest['inputs'].get(spec['inputs'][0]['name'], []) if spec['inputs'] else []
    result = []
    for slot in spec['outputs']:
        value = manifest['outputs'][slot['name']]
        if slot.get('optional') and not value:
            continue
        if slot['mode'] == 'each':
            for index, id in enumerate(main):
                prefix = value
                stem = Path(rows[id].get('label') or rows[id]['name']).stem
                ext = file_extension(slot['kind'])
                result.append(dict(role=slot['name'], source=id, index=index, inputs=[rows[id].get('label', rows[id]['name'])], output=f'{prefix}{stem}{ext}'))
        else:
            result.append(dict(role=slot['name'], inputs=[r.get('label', r['name']) for r in rows.values()], output=value))
    return result or [dict(inputs=[r.get('label', r['name']) for r in rows.values()], output='실행 로그')]


def cl_literal(value, typ='s'):
    if value == 'INDEF': return 'INDEF'
    if typ == 'b': return 'yes' if value in (True, 'yes') else 'no'
    if isinstance(value, (int, float)): return str(value)
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"') + '"'


class GenericTaskRun:
    def __init__(self, job):
        self.job = Path(job).resolve()
        self.m = json.loads((self.job / 'manifest.json').read_text())
        self.spec = self.m['definition']
        self.expected = []
        self.calls = []

    def state(self, message, progress=None, state='running'):
        atomic_json(self.job / 'status.json', dict(state=state, message=message, progress=progress))

    def prepare(self):
        from .image_lists import check_input_lists
        check_input_lists(self.m)
        for path, expected in self.spec['schemaFiles'].items():
            if not Path(path).is_file() or file_hash(path) != expected:
                raise ValueError('IRAF 패키지 정의가 변경되었습니다. 목록을 새로고침한 뒤 다시 실행해 주세요.')
        for folder in ('input', 'output', 'lists', 'uparm'): (self.job / folder).mkdir(exist_ok=True)
        aliases = {}; sources = []
        for index, row in enumerate(self.m['rows']):
            if file_hash(row['path']) != row['sha256']: raise ValueError('입력 파일이 검증 이후 변경되었습니다.')
            alias = f'input/s{index:05d}' + Path(row['path']).suffix
            if not (self.job / alias).exists(): shutil.copy2(row['path'], self.job / alias)
            aliases[row['id']] = alias + row.get('section', '')
            sources.append(dict(id=row['id'], original=row['path'], alias=alias, sha256=row['sha256']))
        atomic_json(self.job / 'sources.json', sources)
        def list_value(name, ids):
            paths = [aliases[id] for id in ids]
            if len(paths) < 2: return paths[0] if paths else ''
            file = 'lists/' + name + '.list'; (self.job / file).write_text('\n'.join(paths) + '\n')
            return '@' + file
        params = dict(self.m['parameters'], **self.spec.get('fixed', {}))
        for slot in self.spec['inputs']:
            ids = self.m['inputs'][slot['name']]
            if ids or not slot.get('scalar'): params[slot['name']] = list_value(slot['name'], ids)
        for name, records in self.m.get('cursorCommands', {}).items():
            if records.strip():
                cursor_path = 'lists/' + name + '.cursor'
                (self.job / cursor_path).write_text(records.rstrip() + '\n')
                params[name] = cursor_path
        for name, records in self.m.get('textInputs', {}).items():
            if records.strip():
                text_path = 'lists/' + name + '.txt'
                (self.job / text_path).write_text(records.rstrip() + '\n')
                params[name] = text_path
        previews = [p for p in preview_generic(self.m) if 'role' in p]
        self.expected = []
        for i, p in enumerate(previews):
            slot = next(s for s in self.spec['outputs'] if s['name'] == p['role'])
            ext = file_extension(slot['kind'])
            self.expected.append(dict(file=f'output/o{i:05d}{ext}', label=p['output'], asset=slot['kind'], role=p['role'], **({'source': p['source'], 'index': p['index']} if 'source' in p else {})))
        for slot in self.spec['outputs']:
            if slot.get('optional') and not self.m['outputs'].get(slot['name']):
                params[slot['name']] = ''
        each = any(s['mode'] == 'each' and self.m['outputs'].get(s['name']) for s in self.spec['outputs'])
        main = self.m['inputs'].get(self.spec['inputs'][0]['name'], []) if self.spec['inputs'] else []
        if each and not main:
            raise ValueError('입력마다 출력을 만드는 작업에는 입력 파일이 필요합니다.')
        # Cardinality describes products, not invocations. IRAF tasks may compute
        # a common trim, append plots, or broadcast coordinates across the list.
        # Pass lists once and let the native task retain those semantics.
        call = dict(params)
        for slot in self.spec['outputs']:
            products = [p['file'] for p in self.expected if p['role'] == slot['name']]
            if slot['name'] == '$stdout' or not products:
                continue
            if slot.get('naming') == 'prefix':
                prefix = 'output/' + slot['name'] + '_'
                call[slot['name']] = prefix
                for product in self.expected:
                    if product['role'] == slot['name']:
                        product['file'] = prefix + Path(aliases[product['source']].split('[')[0]).name
            elif len(products) == 1:
                call[slot['name']] = products[0]
            else:
                listing = 'lists/' + slot['name'] + '-outputs.list'
                (self.job / listing).write_text('\n'.join(products) + '\n')
                call[slot['name']] = '@' + listing
        self.calls = [(call, self.expected)]
        self.write_scripts()

    def write_scripts(self, only=None):
        spec = self.spec
        lines = ['set uparm = ' + cl_literal(str(self.job / 'uparm') + '/'), 'set imtype = "fits"', 'set clobber = "no"']
        py = ['from pyraf import iraf', f'iraf.set(uparm={str(self.job / "uparm") + "/"!r}, imtype="fits", clobber="no")']
        boot = spec.get('bootstrap')
        if boot:
            lines += [f'set {boot["name"]} = {cl_literal(str(Path(boot["path"]).parent) + "/")}', f'task {boot["name"]}.pkg = {cl_literal(boot["path"])}']
            py += [f'iraf.set(**{{{boot["name"]!r}: {str(Path(boot["path"]).parent) + "/"!r}}})', f'iraf.task(**{{{boot["name"] + ".pkg"!r}: {boot["path"]!r}}})']
        for package in spec['loadPackages']:
            lines.append(package); py.append(f'iraf.getPkg({package!r})(_doprint=0)')
        schemas = [(spec['qualified'], spec.get('allParameters', spec['parameters']), self.m['parameters'])]
        schemas += [(s['task'], s['parameters'], self.m['parameterSets'][s['name']]) for s in spec['parameterSets']]
        for task, pars, values in schemas:
            if any(s['name'] == '$package' and s['task'] == task for s in spec['parameterSets']):
                continue  # Package unlearn recursively touches unrelated broken tasks.
            lines.append('unlearn ' + task); py.append(f'iraf.unlearn(iraf.getTask({task!r}))')
        for task, pars, values in schemas[1:]:
            for p in pars:
                if p['name'] not in values:
                    continue
                value = values[p['name']]
                lines.append(f'{task}.{p["name"]} = {cl_literal(value, p["type"])}')
                py.append(f'iraf.getTask({task!r}).setParam({p["name"]!r}, {"iraf.INDEF" if value == "INDEF" else repr(value)})')
        types = {p['name']: p['type'] for p in spec.get('allParameters', spec['parameters'])}
        for index, (params, expected) in enumerate(self.calls):
            if only is not None and index != only: continue
            # Required parameters stay keyword assignments; mode=h prevents CL queries.
            for name, value in params.items(): lines.append(f'{spec["qualified"]}.{name} = {cl_literal(value, types.get(name, "s"))}')
            stdout = next((p['file'] for p in expected if p['role'] == '$stdout'), None)
            redirect = (', > ' + cl_literal(stdout)) if stdout else ''
            lines += [f'lpar {spec["qualified"]} > "parameters-{index:03d}.txt"', f'{spec["qualified"]} (mode="h"{redirect})']
            kwargs = ', '.join(f'{key!r}: {"iraf.INDEF" if value == "INDEF" else repr(value)}' for key, value in params.items())
            py_stdout = (', Stdout=' + repr(stdout)) if stdout else ''
            py += [f'iraf.getTask({spec["qualified"]!r})(**{{{kwargs}}}, mode="h"{py_stdout})', f'iraf.lpar(iraf.getTask({spec["qualified"]!r}), Stdout="parameters-{index:03d}.txt")']
        lines += ['print ("GIRAF_GENERIC_DONE")', 'logout']; py += ['print("GIRAF_GENERIC_DONE")']
        (self.job / 'commands.cl').write_text('\n'.join(lines) + '\n')
        (self.job / 'commands.py').write_text('\n'.join(py) + '\n')

    def execute(self):
        if self.spec.get('executor') == 'image-list':
            from .image_lists import execute_image_list
            return execute_image_list(self)
        self.state('입력과 파라미터 준비 중'); self.prepare()
        with (self.job / 'task.log').open('a') as log:
            for warning in self.m.get('warnings', []):
                log.write(f'WARNING: {warning}\n')
        backend = self.m['backend']; binary = shutil.which('irafcl')
        if backend == 'cl' and not binary: raise ValueError('IRAF CL을 찾지 못했습니다.')
        outcomes = []; products = []
        atomic_json(self.job / 'engine.json', dict(backend=backend, schemaFingerprint=self.spec['schemaFingerprint'], task=self.spec['name']))
        for index, (params, expected) in enumerate(self.calls):
            if (self.job / 'cancel').exists(): raise Cancelled('사용자가 중단했습니다.')
            self.state(f'{self.spec["taskName"]} {index + 1}/{len(self.calls)} 실행 중', index / len(self.calls))
            self.write_scripts(index)
            # Archive each invocation; commands.* remain convenient for API display.
            for suffix in ('cl', 'py'): shutil.copy2(self.job / ('commands.' + suffix), self.job / f'commands-{index:03d}.{suffix}')
            command = [binary, '-f', str(self.job / 'commands.cl')] if backend == 'cl' else [sys.executable, str(self.job / 'commands.py')]
            with (self.job / 'task.log').open('ab') as log:
                start = log.tell(); code = run_process(command, self.job, log, interactive=False, backend=backend)
            text = (self.job / 'task.log').read_bytes()[start:].decode(errors='replace')
            captured = '\n'.join((self.job / p['file']).read_text(errors='replace') for p in expected if p['role'] == '$stdout' and (self.job / p['file']).exists())
            text += '\n' + captured
            failed = bool(code or 'GIRAF_GENERIC_DONE' not in text or re.search(r'(?im)^\s*(?:ERROR|PANIC|FATAL|\*\*.*Syntax error)\b', text.replace('\x07', '')))
            missing = [p['label'] for p in expected if not (self.job / p['file']).is_file()]
            failed = failed or bool(missing)
            ids = [p['source'] for p in expected if 'source' in p] or [r['id'] for r in self.m['rows']] or [self.spec['name']]
            outcomes += [dict(source=id, label=id, state='failed' if failed else 'processed', message=('출력 파일이 없습니다: ' + ', '.join(missing)) if missing else text[-3000:] if failed else 'IRAF task 완료') for id in dict.fromkeys(ids)]
            if not failed:
                products += [dict(p, sha256=file_hash(self.job / p['file'])) for p in expected]
            atomic_json(self.job / 'outcomes.json', outcomes)
        products.append(dict(file='task.log', label=self.spec['taskName'] + '-results.txt', asset='text', role='$log', sha256=file_hash(self.job / 'task.log')))
        atomic_json(self.job / 'products.json', products)
        failed = sum(o['state'] == 'failed' for o in outcomes)
        state = 'failed' if failed == len(outcomes) else 'partial' if failed else 'completed'
        self.state(self.spec['taskName'] + ' ' + {'failed': '실패', 'partial': '부분 실패', 'completed': '완료'}[state], 1, state)
