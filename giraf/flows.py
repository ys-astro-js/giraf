"""foreach, for and if containers (docs/node-structure-brief.md §3.7).

A container is a GIRAF node whose flow component (node schema) says how the
workflow runner expands it; its members and settings are stored in the
workflow document and sent with a run as `flows`:

  {id, label, run: foreach|for|if, members: [task id], variable,
   files: [file id], partition?, start?, end?, step?, condition}

Links address a container by its id. Into it: its input (the list, or the
files an `if` routes) and `result` (member outputs it collects). Out of it:
`item` (foreach), `then` and `else` (if) to members, `results` to the rest of
the workflow. A `for` variable reaches member parameters as the value
`{node: container id, output: variable}`.
"""
import math
from pathlib import Path
import re

from .values import _scalar, evaluate_expression, expression_names

FLOW_RUNS = ('foreach', 'for', 'if')
INNER_PORTS = {'foreach': ('item',), 'for': (), 'if': ('then', 'else')}
COLLECT, RESULTS = 'result', 'results'
MAX_ITERATIONS = 1000
# The container sets it: a header keyword (FILTER, DATE-OBS), 파일 or 숫자.
NAME = re.compile(r'^[^\W\d][\w-]*$')


def flow_range(flow):
    """The numbers of a `for` container: start to end inclusive by step."""
    start, end, step = flow.get('start'), flow.get('end'), flow.get('step')
    if start is None or end is None:
        raise ValueError('시작과 끝 값을 정해 주세요.')
    step = 1 if step is None else step
    if step == 0:
        raise ValueError('간격은 0이 될 수 없습니다.')
    if (end - start) * step < 0:
        raise ValueError('간격의 부호가 시작에서 끝으로 가는 방향과 맞지 않습니다.')
    count = math.floor((end - start) / step + 1e-9) + 1
    if count > MAX_ITERATIONS:
        raise ValueError(f'반복은 {MAX_ITERATIONS}회까지입니다. 지금은 {count}회입니다.')
    integer = all(float(v).is_integer() for v in (start, end, step))
    return [int(round(start + k * step)) if integer else round(start + k * step, 10) for k in range(count)]


def flow_errors(flow):
    """Setting problems of a container, as messages for diagnostics and runs."""
    errors = []
    run = flow.get('run')
    if run in ('foreach', 'for') and not NAME.fullmatch(flow.get('variable') or ''):
        errors.append('반복의 이름표가 올바르지 않습니다. 노드를 다시 추가해 주세요.')
    elif run in ('foreach', 'for') and flow['variable'] == 'name':
        errors.append('name 키워드로는 나눌 수 없습니다. 출력 이름의 {name}과 겹칩니다.')
    if run == 'for':
        try:
            flow_range(flow)
        except ValueError as exc:
            errors.append(str(exc))
    if run == 'if':
        condition = (flow.get('condition') or '').strip()
        if not condition:
            errors.append('조건 식을 적어 주세요.')
        else:
            try:
                evaluate_expression(condition, {name: [1.0] for name in expression_names(condition)})
            except ValueError as exc:
                if '읽지 못했습니다' in str(exc) or '지원하지 않는' in str(exc):
                    errors.append(str(exc))
    return errors


def natural(text):
    return [int(part) if part.isdigit() else part for part in re.split(r'(\d+)', text)]


class Items:
    """Header access for the files a container receives (products or file ids)."""

    def __init__(self, resolve_file):
        self.resolve_file = resolve_file
        self.cache = {}

    def path(self, item):
        path = item.get('path')
        if path and Path(path).is_file():
            return Path(path)
        return Path(self.resolve_file(item['id']))

    def header(self, item, keyword):
        headers = item.get('headers') or {}
        if keyword in headers:
            return _scalar(headers[keyword])
        key = item['id']
        if key not in self.cache:
            from astropy.io import fits
            self.cache[key] = fits.getheader(self.path(item))
        header = self.cache[key]
        return _scalar(header[keyword]) if keyword in header else None

    def label(self, item):
        return item.get('label') or Path(item.get('path') or self.resolve_file(item['id'])).name


def loop_value(flow, iteration, files):
    """What `{variable}` in a member's output names reads in one iteration:
    the `for` number, the partition value, or the foreach file's stem."""
    if 'number' in iteration:
        return str(iteration['number'])
    if iteration.get('partition'):
        return iteration['partition']['value']
    items = iteration['ports'].get('item') or []
    if flow['run'] == 'foreach' and len(items) == 1:
        return Path(files.label(items[0])).stem
    return None


def loop_names(payload, variable, value):
    """A member payload whose output names have `{variable}` replaced."""
    mark = '{' + variable + '}'
    payload['outputs'] = {role: name.replace(mark, value) if isinstance(name, str) else name
                          for role, name in (payload.get('outputs') or {}).items()}
    output = payload.get('output')
    if isinstance(output, dict) and isinstance(output.get('name'), str):
        payload['output'] = dict(output, name=output['name'].replace(mark, value))
    return payload


def constant_outputs(spec, payload, variable):
    """Output roles whose name is the same in every iteration of a loop: not
    per input and without `{variable}`."""
    if spec.get('adapter') != 'generic' or spec.get('run'):
        return []
    mark, parameters = '{' + variable + '}', payload.get('parameters') or {}
    found = []
    for slot in spec.get('outputs', []):
        mode = ('each' if parameters.get(slot['eachWhen']) == 'yes' else 'single') if slot.get('eachWhen') else slot.get('mode')
        name = str((payload.get('outputs') or {}).get(slot['name'], slot.get('default', '')))
        if mode in ('each', 'pass') or (slot.get('optional') and not name) or mark in name:
            continue
        found.append((slot['name'], name))
    return found


def iterations(flow, items, files, variables):
    """[{ports: {port: [item]}, partition?, number?}] for one container run.

    `variables` are the values connected to an `if` condition, by name.
    """
    errors = flow_errors(flow)
    if errors:
        raise ValueError(' '.join(errors))
    run = flow['run']
    if run == 'for':
        return [dict(ports={}, number=n) for n in flow_range(flow)]
    if run == 'foreach':
        keyword = flow.get('partition')
        if not keyword:
            return [dict(ports={'item': [item]}) for item in items]
        groups = {}
        for item in items:
            value = files.header(item, keyword)
            groups.setdefault('' if value is None else str(value).strip(), []).append(item)
        return [dict(ports={'item': groups[key]}, partition=dict(keyword=keyword, value=key))
                for key in sorted(groups, key=natural)]
    condition = flow['condition'].strip()
    keywords = [name for name in expression_names(condition) if name not in variables]

    def holds(values):
        outcome = evaluate_expression(condition, values)
        if len(set(outcome)) > 1:
            raise ValueError('조건 값이 여러 개입니다. 계산 노드에서 하나로 모아 주세요.')
        return bool(outcome[0])
    if not keywords:
        lane = 'then' if holds(variables) else 'else'
        return [dict(ports={'then': items if lane == 'then' else [], 'else': items if lane == 'else' else []})]
    lanes = {'then': [], 'else': []}
    for item in items:
        local = dict(variables)
        for keyword in keywords:
            value = files.header(item, keyword)
            if value is None:
                raise ValueError(f'{files.label(item)}: 헤더에 {keyword} 키워드가 없습니다.')
            local[keyword] = [value]
        lanes['then' if holds(local) else 'else'].append(item)
    return [dict(ports=lanes)]


def lanes(flow, links):
    """Members reached from each inner port of an `if`, through other members."""
    members = set(flow.get('members', []))
    found = {}
    for port in INNER_PORTS.get(flow['run'], ()):
        reached, stack = set(), [l['target'] for l in links
                                 if l['source'] == flow['id'] and l.get('sourceRole') == port and l['target'] in members]
        while stack:
            id = stack.pop()
            if id in reached:
                continue
            reached.add(id)
            stack += [l['target'] for l in links if l['source'] == id and l['target'] in members]
        found[port] = reached
    return found
