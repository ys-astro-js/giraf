"""The CL command a task plan runs, as people read it.

A job writes its own scripts (giraf/generic_tasks/scripts.py, giraf/task_worker.py)
with staged copies and `task.param = value` lines. This renders the same plan
as one command line per invocation: the task, its first input in place, then
inputs, outputs and every parameter that differs from IRAF's default. Input
lists read as `@<input>.list` and outputs by the names the run gives them.
A draft that validation stops on still reads as its line (draft_manifest).
Each line carries the span of each value, named by the field it sets (the
input role, or `name` and `pset.name` for parameters; giraf/field_issues.py),
so the editor marks the field's problems there.
"""
import re

from .task_schema import FILE_EXTENSIONS
from .values import _number

PLAIN = re.compile(r'^[\w@.\-]+$')


def literal(value):
    if isinstance(value, bool):
        return 'yes' if value else 'no'
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    text = str(value)
    return text if text and PLAIN.fullmatch(text) else '"' + text.replace('\\', '\\\\').replace('"', '\\"') + '"'


def argument(name, value, typ):
    if typ == 'b' and str(value) in ('yes', 'no', 'True', 'False'):
        return name + ('+' if str(value) in ('yes', 'True') else '-')
    return f'{name}={literal(value)}'


def differs(value, default):
    a, b = _number(value), _number(default)
    if a is not None and b is not None:
        return a != b
    return str(value).strip() != str(default if default is not None else '').strip()


def files_text(role, ids, rows):
    names = [rows[id].get('label') or rows[id].get('name') or id for id in ids if id in rows]
    if len(names) == 1:
        return names[0]
    return f'@{role}.list' if names else ''


def placeholder(slot):
    """The name an input waiting on a run reads as, the way planned outputs read."""
    if slot.get('multiple', True):
        return f'@{slot["name"]}.list'
    return slot['name'] + FILE_EXTENSIONS.get(slot.get('kind'), '')


def input_text(slot, manifest, rows, pending):
    """An input as the line names it: its files, else the expression as
    written, else a placeholder while it waits on a run."""
    name = slot['name']
    return (files_text(name, manifest['inputs'].get(name, []), rows)
            or (manifest.get('expressions') or {}).get(name, '')
            or (placeholder(slot) if name in pending else ''))


def command_lines(manifest, pending=frozenset()):
    """[(CL line, [token])] of a plan (giraf/task_jobs.py validate_task, or
    draft_manifest). A token is the span of one input, output or parameter
    value in the line: {name, start, end}, named by its field."""
    rows = {r['id']: r for r in manifest.get('rows', [])}
    built = (_generic if manifest.get('adapter') == 'generic' else _adapter)(manifest, rows, pending)
    if built is None:
        return []
    line, args, stdout = built
    tokens = []
    for name, prefix, value in args:
        line += ' ' + prefix
        tokens.append(dict(name=name, start=len(line), end=len(line) + len(value)))
        line += value
    return [(line + (f' > {stdout}' if stdout else ''), tokens)]


def _input(slot, value, first):
    if first:
        return (slot['name'], '', literal(value) if value else '""')
    return (slot['name'], slot['name'] + '=', literal(value))


def _parameter(name, value, typ, field=None):
    text = argument(name, value, typ)
    if text.startswith(name + '='):
        return (field or name, name + '=', text[len(name) + 1:])
    return (field or name, '', text)


def _output(name, names, many):
    return (name, name + '=', literal(names[0]) if len(names) == 1 else many)


def _names(names, written):
    """The output names a run gives, or the name as written when the plan
    cannot name them yet (a draft validation stopped on)."""
    try:
        return names()
    except (ValueError, KeyError, TypeError, OSError):
        return [written] if written else []


def _generic(manifest, rows, pending):
    spec = manifest['definition']
    if spec.get('run'):
        return None
    from .generic_tasks.preview import preview_generic
    args = []
    first = spec['inputs'][0]['name'] if spec['inputs'] else None
    for slot in spec['inputs']:
        name = slot['name']
        value = (manifest.get('expressions') or {}).get(name) or input_text(slot, manifest, rows, pending)
        if not value and ((manifest.get('textInputs') or {}).get(name) or (manifest.get('cursorCommands') or {}).get(name)):
            value = f'{name}.txt'
        if name == first:
            args.insert(0, _input(slot, value, True))
        elif value:
            args.append(_input(slot, value, False))
    previews = lambda: preview_generic(manifest)
    stdout = None
    for slot in spec['outputs']:
        if slot.get('mode') == 'pass':
            continue
        names = _names(lambda: [p['output'] for p in previews() if p.get('role') == slot['name']],
                       manifest['outputs'].get(slot['name']))
        if slot['name'] == '$stdout':
            stdout = names[0] if names else None
        elif names:
            args.append(_output(slot['name'], names, '@' + slot['name'] + '-outputs.list'))
    fixed = spec.get('fixed', {})
    params = dict(manifest.get('parameters') or {}, **fixed)
    outputs = {s['name'] for s in spec['outputs']} | {s['name'] for s in spec['inputs']}
    for p in spec.get('allParameters', spec['parameters']):
        if p['name'] in params and p['name'] not in outputs and differs(params[p['name']], p.get('default')):
            args.append(_parameter(p['name'], params[p['name']], p.get('type', 's')))
    for pset in spec.get('parameterSets', []):
        values = (manifest.get('parameterSets') or {}).get(pset['name'], {})
        for p in pset.get('allParameters', pset['parameters']):
            if p['name'] in values and differs(values[p['name']], p.get('default')):
                args.append(_parameter(p['name'], values[p['name']], p.get('type', 's'), f'{pset["name"]}.{p["name"]}'))
    return spec.get('taskName') or spec['name'], args, stdout


def _adapter(manifest, rows, pending):
    from .task_catalog import TASKS, parameters
    from .task_jobs import preview_task
    spec = TASKS[manifest['task']]
    args = []
    for index, slot in enumerate(spec['inputs']):
        value = input_text(slot, manifest, rows, pending)
        if index == 0 or value:
            args.append(_input(slot, value, index == 0))
    output = spec['output']
    if output and output['mode'] != 'edit':
        names = _names(lambda: [r['output'] for r in preview_task(manifest)], manifest['output']['name'])
        if names:
            args.append(_output(output['name'], names, '@output.list'))
    for p in parameters(manifest['task']):
        value = (manifest.get('parameters') or {}).get(p['name'])
        if value is not None and differs(value, p.get('default')):
            args.append(_parameter(p['name'], value, p.get('type', 's')))
    return manifest['task'], args, None


def draft_manifest(payload, resolve):
    """The plan as a draft holds it, for its line while validation stops on a
    problem: the files that resolve, and expressions, names and values as
    written. Nothing runs from it; a run validates (validate_task)."""
    from copy import deepcopy
    from .task_catalog import TASKS
    from .task_jobs import DEFAULT_MAPPING
    spec = TASKS[payload['task']]
    inputs, rows = {}, {}
    for role, ids in (payload.get('inputs') or {}).items():
        inputs[role] = []
        for id in ids if isinstance(ids, list) else []:
            try:
                rows[id] = resolve(id)
            except (ValueError, KeyError, TypeError, OSError):
                continue
            inputs[role].append(id)
    plan = dict(task=spec['name'], name=spec['name'], inputs=inputs, rows=list(rows.values()),
                expressions=dict(payload.get('expressions') or {}), parameters=dict(payload.get('parameters') or {}),
                workingDirectory=payload.get('workingDirectory') or '')
    if spec.get('adapter') != 'generic':
        output = (payload.get('output') or {}).get('name', spec['output']['default'] if spec['output'] else '')
        return dict(plan, output=dict(name=str(output)), mapping=payload.get('mapping') or DEFAULT_MAPPING)
    definition = deepcopy(spec)
    for slot in definition['outputs']:
        if slot.get('eachWhen'):
            slot['mode'] = 'each' if str(plan['parameters'].get(slot['eachWhen'])) in ('yes', 'True') else 'single'
    outputs = {s['name']: str((payload.get('outputs') or {}).get(s['name'], s['default'])) for s in definition['outputs']}
    return dict(plan, adapter='generic', definition=definition, outputs=outputs,
                parameterSets=dict(payload.get('parameterSets') or {}), textInputs=dict(payload.get('textInputs') or {}),
                cursorCommands=dict(payload.get('cursorCommands') or {}))

