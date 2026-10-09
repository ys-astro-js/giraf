"""Loop regions (docs/node-structure-brief.md §3.5, docs/node-schema.md).

A region is a GIRAF node with the `foreach` flow component, drawn as a group
around the tasks it repeats; its settings are stored in the workflow document
and sent with a run as `flows`:

  {id, label, members: [task or inner region id], criteria: [criterion],
   split?: {taskId, outputRole?}, splitFiles?: [file id], condition?}
  criterion: {keyword} | {expression, name} | {count, order} | {each: true} | {times}

A region has no ports. Links go straight from outside sources to member
inputs; a link crossing a region's border receives files by the mode stored on
it, `flow: {region id: {mode: all|match, keys}}`, or by default (receive).
The split source's files are divided into rounds by the criteria; results made
in a round carry its values as labels `{name: value}`, which later regions
match and split by. `splitFiles` are the split source's files when that source
is not part of this run, resolved by the editor.
"""
from pathlib import Path
import re

from .values import _number, _scalar, evaluate_expression, expression_names, pass_value, same_value

MAX_ROUNDS = 1000
# A header keyword (FILTER, DATE-OBS) or a name the region gives (묶음, 파일, 회차).
NAME = re.compile(r'^[^\W\d][\w-]*$')
CHUNK, EACH, TIMES = '묶음', '파일', '회차'


def label_name(criterion):
    """The label a criterion puts on results: its keyword, its expression's name, 묶음, 파일 or 회차."""
    if 'keyword' in criterion:
        return criterion['keyword']
    if 'expression' in criterion:
        return criterion.get('name') or ''
    if 'count' in criterion:
        return CHUNK
    if criterion.get('each'):
        return EACH
    return TIMES


def flow_labels(flow):
    return [label_name(c) for c in flow.get('criteria') or []]


def splits(flow):
    """A region divides files unless it only repeats a number of times."""
    criteria = flow.get('criteria') or []
    return bool((flow.get('condition') or '').strip()) or any('times' not in c for c in criteria)


def _whole(value, low, high):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and float(value).is_integer() and low <= value <= high


def _expression_error(text):
    try:
        evaluate_expression(text, {name: [1.0] for name in expression_names(text)})
    except ValueError as exc:
        if '읽지 못했습니다' in str(exc) or '지원하지 않는' in str(exc):
            return str(exc)
    return None


def flow_errors(flow):
    """Setting problems of a region, as messages for diagnostics and runs."""
    errors = []
    criteria = flow.get('criteria') or []
    condition = (flow.get('condition') or '').strip()
    if not criteria and not condition:
        errors.append('무엇마다 반복할지 정해 주세요.')
    for criterion in criteria:
        if 'keyword' in criterion:
            if not NAME.fullmatch(criterion['keyword'] or ''):
                errors.append('헤더 키워드 이름이 올바르지 않습니다. 다시 골라 주세요.')
        elif 'expression' in criterion:
            if not (criterion.get('expression') or '').strip():
                errors.append('식을 적어 주세요.')
            elif problem := _expression_error(criterion['expression']):
                errors.append(problem)
            if not NAME.fullmatch(criterion.get('name') or ''):
                errors.append('식 결과의 이름이 올바르지 않습니다.')
        elif 'count' in criterion:
            if not _whole(criterion['count'], 1, MAX_ROUNDS):
                errors.append('몇 장씩 나눌지 1 이상의 정수로 정해 주세요.')
            order = criterion.get('order') or 'name'
            if order != 'name' and not NAME.fullmatch(order):
                errors.append('순서를 정할 헤더 키워드 이름이 올바르지 않습니다.')
        elif criterion.get('each'):
            pass
        elif 'times' in criterion:
            if not _whole(criterion['times'], 1, MAX_ROUNDS):
                errors.append(f'반복 횟수는 1부터 {MAX_ROUNDS}까지의 정수입니다.')
        else:
            errors.append('알 수 없는 기준입니다. 다시 골라 주세요.')
    names = flow_labels(flow)
    if 'name' in names:
        errors.append('name으로는 나눌 수 없습니다. 출력 이름의 {name}과 겹칩니다.')
    if len(set(names)) != len(names):
        errors.append('같은 이름의 기준이 두 번 있습니다.')
    if condition and (problem := _expression_error(condition)):
        errors.append(problem)
    if splits(flow) and not (flow.get('split') or {}).get('taskId'):
        errors.append('나눌 파일을 골라 주세요.')
    return errors


def natural(text):
    return [int(part) if part.isdigit() else part for part in re.split(r'(\d+)', str(text))]


class Items:
    """Header and label access for the files a region handles (products or file ids)."""

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

    def value(self, item, name):
        """What a region reads for a name: the file's label of that name, else its header."""
        labels = item.get('labels') or {}
        return str(labels[name]) if name in labels else self.text(item, name)

    def variables(self, item, names):
        """Expression variables of one file: labels, then headers."""
        found = {}
        for name in names:
            labels = item.get('labels') or {}
            value = _scalar(labels[name]) if name in labels else self.header(item, name)
            if value is None:
                raise ValueError(f'{self.label(item)}: 헤더에 {name} 키워드가 없습니다.')
            found[name] = [value]
        return found


def _text(value):
    return str(value).strip() if not isinstance(value, float) else repr(value)


def holds(condition, item, files):
    outcome = evaluate_expression(condition, files.variables(item, expression_names(condition)))
    return bool(outcome[0])


def _order_key(files, order):
    def key(item):
        if order == 'name':
            return (0, natural(files.label(item)))
        text = files.value(item, order)
        number = _number(text)
        return (0, number) if number is not None else (1, natural(text))
    return key


def rounds(flow, items, files):
    """[{values: {label: value}, items: [item]}] of one region run.

    Criteria refine the rounds in order: by value (keyword, expression, file),
    in chunks (count), or repeated (times); rounds sort naturally by their
    values: B 15, B 30, V 15. Values keep the text they were read as.
    """
    errors = flow_errors(flow)
    if errors:
        raise ValueError(' '.join(errors))
    condition = (flow.get('condition') or '').strip()
    if condition:
        items = [item for item in items if holds(condition, item, files)]
    # Each round: its values, its items and how values read differently to people.
    groups = [({}, list(items), {})] if items or not splits(flow) else []
    for criterion in flow.get('criteria') or []:
        name, refined = label_name(criterion), []
        for values, members, shown in groups:
            if 'times' in criterion:
                refined += [({**values, name: str(n)}, members, shown) for n in range(1, int(criterion['times']) + 1)]
            elif 'count' in criterion:
                ordered = sorted(members, key=_order_key(files, criterion.get('order') or 'name'))
                size = int(criterion['count'])
                for k in range(0, len(ordered), size):
                    end = min(k + size, len(ordered))
                    # Named by the files it takes, `1–5`; its value stays the chunk number.
                    refined.append(({**values, name: str(k // size + 1)}, ordered[k:end],
                                    {**shown, name: f'{k + 1}–{end}' if end - k > 1 else str(end)}))
            else:
                found = {}
                for item in members:
                    if 'keyword' in criterion:
                        value = files.value(item, criterion['keyword'])
                    elif 'expression' in criterion:
                        value = _text(evaluate_expression(criterion['expression'],
                                                          files.variables(item, expression_names(criterion['expression'])))[0])
                    else:
                        value = Path(files.label(item)).stem
                    # 15 and 15.0 are one round, named as the first file has it.
                    key = next((k for k in found if same_value(k, value)), value)
                    found.setdefault(key, []).append(item)
                refined += [({**values, name: value}, group, shown) for value, group in found.items()]
        groups = refined
        if len(groups) > MAX_ROUNDS:
            raise ValueError(f'반복은 {MAX_ROUNDS}회까지입니다. 지금은 {len(groups)}회입니다.')
    names = flow_labels(flow)
    groups.sort(key=lambda group: [natural(group[0][n]) for n in names])
    return [dict(values=values, items=members, name=pass_name(values, shown)) for values, members, shown in groups]


def pass_name(values, shown=None):
    """How a round is named to people: its values in criteria order, `B 30`
    (pass_value: a header's 30.0 reads 30); a chunk reads as its files, `15 1–5`."""
    shown = shown or {}
    return ' '.join(shown[name] if name in shown else pass_value(value) if str(value).strip() else '없음'
                    for name, value in values.items())


def _final(word):
    text = word.strip()
    last = text[-1:] or ' '
    code = ord(last) - 0xAC00
    if 0 <= code <= 11171:
        return code % 28 != 0
    if last.isdigit():
        return last in '0136780'
    return bool(re.search(r'([lmn]|ng)$', text, re.IGNORECASE))


def with_subject(word):
    """`파일이`, `dark가` (web/src/lib/korean.ts)."""
    return word + ('이' if _final(word) else '가')


def with_object(word):
    """`datapars를`, `param을`."""
    return word + ('을' if _final(word) else '를')


def with_topic(word):
    """`Master Dark는`, `영상은`."""
    return word + ('은' if _final(word) else '는')


def loop_values(values):
    """{label: value} member output names read in one round: `Dark{EXPTIME}.fits`
    is Dark15.fits for 15.0."""
    return {name: pass_value(value) for name, value in values.items()}


def loop_names(payload, values):
    """A member payload whose output names have each `{label}` replaced."""
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
    """Output roles whose name is the same in every round of a region: not
    per input and without any of the region's `{label}`s."""
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


def receive_mode(link, region, labels):
    """How a link crossing into `region` receives: ('split',), ('match', keys) or ('all',).

    The split source divides; a stored mode wins; otherwise labels the source
    carries under the region's label names match, and anything else reaches
    every round as it is.
    """
    split = region.get('split') or {}
    if split.get('taskId') and link.get('source') == split['taskId'] and \
            (not split.get('outputRole') or not link.get('sourceRole') or split['outputRole'] == link['sourceRole']):
        return ('split',)
    stored = (link.get('flow') or {}).get(region['id'])
    if stored:
        return ('match', list(stored.get('keys') or [])) if stored.get('mode') == 'match' else ('all',)
    keys = [name for name in flow_labels(region) if name in labels]
    return ('match', keys) if keys else ('all',)


def matching(products, keys, values, files):
    return [p for p in products if all(same_value(files.value(p, k), values.get(k, '')) for k in keys)]


def unmatched_labels(products, region):
    """Labels the products differ in that the region does not run by."""
    names = set(flow_labels(region))
    found = {}
    for product in products:
        for name, value in (product.get('labels') or {}).items():
            if name not in names:
                found.setdefault(name, set()).add(pass_value(value))
    return [name for name, values in found.items() if len(values) > 1]
