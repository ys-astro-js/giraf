"""foreach, for and if containers (docs/node-structure-brief.md §3.7).

A container is a GIRAF node whose flow component (node schema) says how the
workflow runner expands it; its members and settings are stored in the
workflow document and sent with a run as `flows`:

  {id, label, run: foreach|for|if, members: [task id], variable,
   files: [file id], keywords?: [keyword], fileInputs?: [file input],
   start?, end?, step?, condition}
  file input: {target, role, kind, multiple, files: [file id]}

Links address a container by its id. Into it: its input (the list, or the
files an `if` routes; a foreach takes several links and their files once
each) and `result` (member outputs it collects). Out of it: `item` (foreach),
`then` and `else` (if) to members, `results` to the rest of the workflow. A
`for` variable reaches member parameters as the value
`{node: container id, output: variable}`.

A foreach runs once per file, or once per combination of the values its
`keywords` take in the files' headers (an older document's `partition` is one
keyword). Files reaching a member from outside the loop, by a link or as
`fileInputs` resolved by the editor, are matched to the pass (match_pass).
"""
import math
from pathlib import Path
import re

from .values import _number, _scalar, evaluate_expression, expression_names

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


def flow_keywords(flow):
    """The header keywords a foreach runs by; an older document names one as `partition`."""
    if flow.get('run') != 'foreach':
        return []
    return list(flow.get('keywords') or ([flow['partition']] if flow.get('partition') else []))


def loop_variables(flow):
    """Names member output names may use: each keyword, and the container's variable."""
    names = flow_keywords(flow)
    variable = flow.get('variable')
    return names + [variable] if variable and variable not in names else names


def flow_errors(flow):
    """Setting problems of a container, as messages for diagnostics and runs."""
    errors = []
    run = flow.get('run')
    if run in ('foreach', 'for') and not NAME.fullmatch(flow.get('variable') or ''):
        errors.append('반복의 이름표가 올바르지 않습니다. 노드를 다시 추가해 주세요.')
    elif run in ('foreach', 'for') and 'name' in loop_variables(flow):
        errors.append('name 키워드로는 나눌 수 없습니다. 출력 이름의 {name}과 겹칩니다.')
    elif any(not NAME.fullmatch(keyword or '') for keyword in flow_keywords(flow)):
        errors.append('나눌 헤더 키워드 이름이 올바르지 않습니다. 다시 골라 주세요.')
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

    def fits_header(self, item):
        key = item['id']
        if key not in self.cache:
            from astropy.io import fits
            self.cache[key] = fits.getheader(self.path(item))
        return self.cache[key]

    def header(self, item, keyword):
        headers = item.get('headers') or {}
        if keyword in headers:
            return _scalar(headers[keyword])
        header = self.fits_header(item)
        return _scalar(header[keyword]) if keyword in header else None

    def label(self, item):
        return item.get('label') or Path(item.get('path') or self.resolve_file(item['id'])).name

    def text(self, item, keyword):
        """A header value as the editor shows it (giraf/model.py header_values):
        '' when absent, or for a file without a readable header such as text."""
        headers = item.get('headers') or {}
        if keyword in headers:
            return str(headers[keyword]).strip()
        try:
            value = self.fits_header(item).get(keyword)
        except (OSError, ValueError, KeyError, TypeError):
            return ''
        from astropy.io import fits
        if value is None or isinstance(value, fits.card.Undefined):
            return ''
        return value.strip() if isinstance(value, str) else str(value)


def same_value(a, b):
    """Header values as the loop compares them: as numbers when both read as
    one (15 is 15.0), otherwise as trimmed text."""
    x, y = _number(a), _number(b)
    return x == y if x is not None and y is not None else a.strip() == b.strip()


def match_pass(products, values, files, passes):
    """(products, matched) a pass takes from a connection from outside its loop.

    A loop keyword matches the connection when its files differ in it and at
    least one of them has a value one of the loop's `passes` has. The pass
    keeps the files equal to its values in every matching keyword; with none
    (one file, files that all agree, files without the keyword such as text,
    values no pass has) the connection reaches every pass as it is.
    """
    def used(k):
        found = [files.text(p, k) for p in products]
        return any(not same_value(v, found[0]) for v in found) and \
            any(same_value(v, other.get(k, '')) for v in found for other in passes)
    keys = [k for k in values if used(k)]
    if not keys:
        return products, False
    return [p for p in products if all(same_value(files.text(p, k), values[k]) for k in keys)], True


def pass_name(values):
    """How a pass is named to people: its values in keyword order, `B 30`."""
    return ' '.join(value or '없음' for value in values.values())


def with_subject(word):
    """`파일이`, `dark가` (web/src/lib/korean.ts)."""
    text = word.strip()
    last = text[-1:] or ' '
    code = ord(last) - 0xAC00
    if 0 <= code <= 11171:
        final = code % 28 != 0
    elif last.isdigit():
        final = last in '0136780'
    else:
        final = bool(re.search(r'([lmn]|ng)$', text, re.IGNORECASE))
    return word + ('이' if final else '가')


def loop_values(flow, iteration, files):
    """{variable: value} member output names read in one iteration: the
    `for` number, each keyword's value, or the foreach file's stem."""
    variable = flow.get('variable')
    if 'number' in iteration:
        return {variable: str(iteration['number'])} if variable else {}
    pairs = dict(iteration.get('partition') or {})
    if pairs:
        # An older document's variable reads its one keyword's value.
        if variable and variable not in pairs and len(pairs) == 1:
            pairs[variable] = next(iter(pairs.values()))
        return pairs
    items = iteration['ports'].get('item') or []
    if variable and flow['run'] == 'foreach' and len(items) == 1:
        return {variable: Path(files.label(items[0])).stem}
    return {}


def loop_names(payload, values):
    """A member payload whose output names have each `{variable}` replaced."""
    def named(name):
        for variable, value in values.items():
            name = name.replace('{' + variable + '}', value)
        return name
    payload['outputs'] = {role: named(name) if isinstance(name, str) else name
                          for role, name in (payload.get('outputs') or {}).items()}
    output = payload.get('output')
    if isinstance(output, dict) and isinstance(output.get('name'), str):
        payload['output'] = dict(output, name=named(output['name']))
    return payload


def constant_outputs(spec, payload, variables):
    """Output roles whose name is the same in every iteration of a loop: not
    per input and without any of the loop's `{variable}`s."""
    if spec.get('adapter') != 'generic' or spec.get('run'):
        return []
    variables = [variables] if isinstance(variables, str) else variables
    marks, parameters = ['{' + v + '}' for v in variables], payload.get('parameters') or {}
    found = []
    for slot in spec.get('outputs', []):
        mode = ('each' if parameters.get(slot['eachWhen']) == 'yes' else 'single') if slot.get('eachWhen') else slot.get('mode')
        name = str((payload.get('outputs') or {}).get(slot['name'], slot.get('default', '')))
        if mode in ('each', 'pass') or (slot.get('optional') and not name) or any(m in name for m in marks):
            continue
        found.append((slot['name'], name))
    return found


def iterations(flow, items, files, variables):
    """[{ports: {port: [item]}, partition?, number?}] for one container run.

    A foreach pass by keywords has `partition`, its values `{keyword: value}`.
    `variables` are the values connected to an `if` condition, by name.
    """
    errors = flow_errors(flow)
    if errors:
        raise ValueError(' '.join(errors))
    run = flow['run']
    if run == 'for':
        return [dict(ports={}, number=n) for n in flow_range(flow)]
    if run == 'foreach':
        keywords = flow_keywords(flow)
        if not keywords:
            return [dict(ports={'item': [item]}) for item in items]
        groups = {}
        for item in items:
            groups.setdefault(tuple(files.text(item, k) for k in keywords), []).append(item)
        # One pass per combination of values, sorted naturally: B 15, B 30, V 15.
        return [dict(ports={'item': groups[key]}, partition=dict(zip(keywords, key)))
                for key in sorted(groups, key=lambda key: [natural(v) for v in key])]
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
