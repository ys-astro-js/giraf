"""The CL command a validated task plan runs, as people read it.

A job writes its own scripts (giraf/generic_tasks/scripts.py, giraf/task_worker.py)
with staged copies and `task.param = value` lines. This renders the same plan
as one command line per invocation: the task, its first input in place, then
inputs, outputs and every parameter that differs from IRAF's default. Input
lists read as `@<input>.list` and outputs by the names the run gives them.
"""
import re

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


def command_lines(manifest):
    """[CL line] of a validated plan (giraf/task_jobs.py validate_task)."""
    rows = {r['id']: r for r in manifest.get('rows', [])}
    if manifest.get('adapter') == 'generic':
        return _generic(manifest, rows)
    return _adapter(manifest, rows)


def _generic(manifest, rows):
    spec = manifest['definition']
    if spec.get('run'):
        return []
    from .generic_tasks.preview import preview_generic
    args = []
    first = spec['inputs'][0]['name'] if spec['inputs'] else None
    for slot in spec['inputs']:
        name = slot['name']
        value = (manifest.get('expressions') or {}).get(name) or files_text(name, manifest['inputs'].get(name, []), rows)
        if not value and ((manifest.get('textInputs') or {}).get(name) or (manifest.get('cursorCommands') or {}).get(name)):
            value = f'{name}.txt'
        if name == first:
            args.insert(0, literal(value) if value else '""')
        elif value:
            args.append(f'{name}={literal(value)}')
    previews = preview_generic(manifest)
    for slot in spec['outputs']:
        if slot['name'] == '$stdout' or slot.get('mode') == 'pass':
            continue
        names = [p['output'] for p in previews if p.get('role') == slot['name']]
        if names:
            args.append(f'{slot["name"]}={literal(names[0]) if len(names) == 1 else "@" + slot["name"] + "-outputs.list"}')
    fixed = spec.get('fixed', {})
    params = dict(manifest.get('parameters') or {}, **fixed)
    outputs = {s['name'] for s in spec['outputs']} | {s['name'] for s in spec['inputs']}
    for p in spec.get('allParameters', spec['parameters']):
        if p['name'] in params and p['name'] not in outputs and differs(params[p['name']], p.get('default')):
            args.append(argument(p['name'], params[p['name']], p.get('type', 's')))
    for pset in spec.get('parameterSets', []):
        values = (manifest.get('parameterSets') or {}).get(pset['name'], {})
        for p in pset.get('allParameters', pset['parameters']):
            if p['name'] in values and differs(values[p['name']], p.get('default')):
                args.append(argument(p['name'], values[p['name']], p.get('type', 's')))
    stdout = next((p['output'] for p in previews if p.get('role') == '$stdout'), None)
    return [' '.join([spec.get('taskName') or spec['name'], *args]) + (f' > {stdout}' if stdout else '')]


def _adapter(manifest, rows):
    from .task_catalog import TASKS, parameters
    from .task_jobs import preview_task
    spec = TASKS[manifest['task']]
    args = []
    for index, slot in enumerate(spec['inputs']):
        value = files_text(slot['name'], manifest['inputs'].get(slot['name'], []), rows)
        if index == 0:
            args.append(value or '""')
        elif value:
            args.append(f'{slot["name"]}={literal(value)}')
    if spec['output'] and spec['output']['mode'] != 'edit':
        names = [r['output'] for r in preview_task(manifest)]
        if names:
            args.append(f'{spec["output"]["name"]}={literal(names[0]) if len(names) == 1 else "@output.list"}')
    for p in parameters(manifest['task']):
        value = (manifest.get('parameters') or {}).get(p['name'])
        if value is not None and differs(value, p.get('default')):
            args.append(argument(p['name'], value, p.get('type', 's')))
    return [' '.join([manifest['task'], *args])]
