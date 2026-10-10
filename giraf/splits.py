"""Split execution (docs/node-schema.md 나눠서 실행).

A task may split ONE of its file-list inputs into groups; each group is one
IRAF invocation with that group's files as the input list. The settings are
part of the task's payload:

  split:       {input, by: [part]}
  part:        {key: <header keyword>} | {per: N} | {each: true}
  pairing:     {<input>: rule}
  rule:        {by: <header keyword>} | {order: true} | {iraf: true} | {manual: {<group id>: <file id>}}
  groupValues: {<parameter>: {<group id>: value}}   ('pset.name' for a pset parameter)
  formulas:    {<parameter>: <IRAF expression of the task's other parameters>}

Parts refine the groups in order: a key groups by the real FITS header value,
`per` chunks each group's files in file-name order, `each` makes a group of
every file. Another input with several files reaches each group by its rule;
one file (or none) goes to every group, as IRAF lists do. Nothing is guessed:
an input without a rule stops the run. The editor groups the same way
(web/src/lib/splits.ts).
"""
from pathlib import Path
import re

from .values import _number, evaluate_expression, expression_names, pass_value, same_value

# Fields of a payload that only GIRAF reads; IRAF validation never sees them.
FIELDS = ('split', 'pairing', 'groupValues', 'formulas')
NAME = re.compile(r'^[^\W\d][\w-]*$')
MAX_GROUPS = 1000
PAIR_MISSING = '짝 맞추기를 정하세요'


class SplitError(ValueError):
    """A setting or file problem of a split task, named for the node it is on."""


def natural(text):
    return [(0, int(part), '') if part.isdigit() else (1, 0, part) for part in re.split(r'(\d+)', str(text)) if part]


class Files:
    """Header values and names of the files a task splits or pairs (file ids)."""

    def __init__(self, resolve_file, label_of=None, headers_of=None):
        self.resolve_file, self.label_of, self.headers_of = resolve_file, label_of, headers_of
        self.cache = {}

    def path(self, id):
        return Path(self.resolve_file(id))

    def label(self, id):
        label = self.label_of(id) if self.label_of else None
        return label or self.path(id).name

    def text(self, id, keyword):
        """A header value as the editor reads it (giraf/model.py header_values):
        '' when absent, or for a file without a readable header."""
        known = (self.headers_of(id) if self.headers_of else None) or {}
        if keyword in known:
            return str(known[keyword]).strip()
        if id not in self.cache:
            from astropy.io import fits
            try:
                self.cache[id] = fits.getheader(self.path(id))
            except (OSError, ValueError, KeyError, TypeError):
                self.cache[id] = {}
        value = self.cache[id].get(keyword)
        from astropy.io import fits
        if value is None or isinstance(value, fits.card.Undefined):
            return ''
        return value.strip() if isinstance(value, str) else str(value)


def stem(label):
    base = str(label).split('/')[-1]
    dot = base.find('.')
    return base[:dot] if dot > 0 else base


def part_errors(split):
    """Setting problems of a split, as messages for diagnostics and runs."""
    errors = []
    parts = (split or {}).get('by') or []
    if not (split or {}).get('input'):
        errors.append('나눌 입력을 골라 주세요.')
    for part in parts:
        if 'key' in part:
            if not NAME.fullmatch(str(part.get('key') or '')):
                errors.append('나눌 헤더 키워드 이름이 올바르지 않습니다.')
        elif 'per' in part:
            per = part.get('per')
            if not isinstance(per, int) or isinstance(per, bool) or per < 1:
                errors.append('몇 장씩 나눌지 1 이상의 정수로 정해 주세요.')
        elif not part.get('each'):
            errors.append('알 수 없는 나누기입니다. 다시 골라 주세요.')
    return errors


def _key_order(values):
    """Sort numerically when every value reads as a number, else as text."""
    if all(_number(v) is not None for v in values):
        return lambda v: (_number(v),)
    return lambda v: tuple(natural(v))


def split_groups(ids, parts, files):
    """[{id, name, values, files, keys, suffix}] of a split, in order.

    `id` joins each part's value (a key's value as people read it, a chunk's
    number, a file's stem) with `/`; `name` reads a chunk as the files it takes
    (`1–5`); `keys` are the header values a group was made by, which pairing
    reads; `suffix` is what default output names take (output_suffix).
    """
    ordered = sorted(ids, key=lambda id: natural(files.label(id)))
    groups = [dict(values=[], names=[], kinds=[], files=ordered, keys={})]
    for part in parts:
        refined = []
        for group in groups:
            if 'key' in part:
                key, found = part['key'], {}
                for id in group['files']:
                    value = pass_value(files.text(id, key))
                    # 15 and 15.0 are one group, named as the first file reads it.
                    value = next((v for v in found if same_value(v, value)), value)
                    found.setdefault(value, []).append(id)
                order = _key_order([v for v in found if v])
                for value in sorted(found, key=lambda v: (v == '', order(v) if v else ())):
                    refined.append(dict(group, values=[*group['values'], value], names=[*group['names'], value or '없음'],
                                        kinds=[*group['kinds'], 'key'], files=found[value], keys={**group['keys'], key: value}))
            elif 'per' in part:
                size, members = int(part['per']), group['files']
                for start in range(0, len(members), size):
                    end = min(start + size, len(members))
                    refined.append(dict(group, values=[*group['values'], str(start // size + 1)],
                                        names=[*group['names'], f'{start + 1}–{end}' if end - start > 1 else str(end)],
                                        kinds=[*group['kinds'], 'per'], files=members[start:end]))
            else:
                for id in group['files']:
                    name = stem(files.label(id))
                    refined.append(dict(group, values=[*group['values'], name], names=[*group['names'], name],
                                        kinds=[*group['kinds'], 'each'], files=[id]))
        groups = refined
        if len(groups) > MAX_GROUPS:
            raise SplitError(f'나눈 묶음은 {MAX_GROUPS}개까지입니다. 지금은 {len(groups)}개입니다.')
    return [dict(id='/'.join(g['values']), name=' '.join(g['names']), values=g['values'], files=g['files'],
                 keys=g['keys'], suffix=output_suffix(g['values'], g['kinds'])) for g in groups if g['files'] or not parts]


def output_suffix(values, kinds):
    """What a group adds to output names: key values together, then a chunk's
    number or a file's stem after `-` (`15` and chunk 1: `15-1`); a chunk or
    file alone adds its bare value (`1`)."""
    text = ''
    for value, kind in zip(values, kinds):
        value = re.sub(r'\s+', '', value)
        text += value if kind == 'key' or not text else '-' + value
    return text


def with_suffix(name, suffix):
    """`Dark.fits` with `15-1` is `Dark15-1.fits`; the suffix goes before the
    first dot of the file name, so IRAF names keep their tail (`m67.coo.1`)."""
    if not suffix:
        return name
    head, sep, base = str(name).rpartition('/')
    dot = base.find('.')
    base = base[:dot] + suffix + base[dot:] if dot > 0 else base + suffix
    return head + sep + base


def group_outputs(spec, payload, suffix):
    """Name the outputs one group makes: a single output takes the suffix;
    per-input, passed and edited outputs keep their per-file names."""
    if not suffix or not spec:
        return payload
    parameters = payload.get('parameters') or {}
    if spec.get('adapter') == 'generic':
        if spec.get('run'):
            return payload
        outputs = dict(payload.get('outputs') or {})
        for slot in spec.get('outputs', []):
            mode = ('each' if parameters.get(slot['eachWhen']) == 'yes' else 'single') if slot.get('eachWhen') else slot.get('mode')
            name = str(outputs.get(slot['name'], slot.get('default', '')) or '')
            if mode in ('each', 'pass', 'edit') or not name or '{name}' in name or name.startswith('@') or ',' in name:
                continue
            outputs[slot['name']] = with_suffix(name, suffix)
        payload['outputs'] = outputs
    elif spec.get('output') and spec['output'].get('mode') not in ('each', 'edit'):
        name = str((payload.get('output') or {}).get('name') or spec['output'].get('default') or '')
        if name and not name.startswith('@') and ',' not in name:
            payload['output'] = dict(payload.get('output') or {}, name=with_suffix(name, suffix))
    return payload


def pair_files(role, rule, candidates, groups, files):
    """{group id: [file id]} an input with several files gives each group by
    its rule. Raises SplitError naming the group a rule cannot pair."""
    rule = rule or {}
    if 'by' in rule:
        key = str(rule['by'])
        found = {}
        for group in groups:
            values = [pass_value(files.text(id, key)) for id in group['files']]
            value = values[0] if values else ''
            if any(not same_value(value, other) for other in values):
                raise SplitError(f'{group["name"]}: 나눈 파일의 {key} 값이 서로 다릅니다.')
            matched = [id for id in candidates if same_value(files.text(id, key), value)]
            if not matched:
                raise SplitError(f'{group["name"]}: {key} {value or "없음"}에 맞는 {role} 파일이 없습니다.')
            if len(matched) > 1:
                raise SplitError(f'{group["name"]}: {key} {value or "없음"}에 맞는 {role} 파일이 {len(matched)}개입니다.')
            found[group['id']] = matched
        return found
    if rule.get('order'):
        if len(candidates) != len(groups):
            raise SplitError(f'{role} 파일 {len(candidates)}개를 묶음 {len(groups)}개에 순서대로 맞출 수 없습니다.')
        return {group['id']: [id] for group, id in zip(groups, candidates)}
    if rule.get('iraf'):
        return {group['id']: list(candidates) for group in groups}
    if isinstance(rule.get('manual'), dict):
        chosen = rule['manual']
        found = {}
        for group in groups:
            id = chosen.get(group['id'])
            if id not in candidates:
                raise SplitError(f'{group["name"]}: {role} 파일을 골라 주세요.')
            found[group['id']] = [id]
        return found
    raise SplitError(f'{role}: {PAIR_MISSING}')


def split_problems(payload, files, pending=frozenset()):
    """[(severity, message)] of a split task whose files are known: settings,
    and each input a rule cannot pair. Inputs still waiting on a run are left
    to the run."""
    split = payload.get('split')
    if not split:
        return []
    errors = part_errors(split)
    if errors:
        return [('error', message) for message in errors]
    if split['input'] in pending:
        return []
    try:
        groups = split_groups(payload.get('inputs', {}).get(split['input'], []), split.get('by') or [], files)
    except SplitError as exc:
        return [('error', str(exc))]
    problems = []
    for role, ids in (payload.get('inputs') or {}).items():
        if role == split['input'] or role in pending or len(ids) < 2 or len(groups) < 2:
            continue
        try:
            pair_files(role, (payload.get('pairing') or {}).get(role), ids, groups, files)
        except SplitError as exc:
            missing = not (payload.get('pairing') or {}).get(role)
            problems.append(('warning' if missing else 'error', str(exc)))
    return problems


def group_runs(payload, files, spec=None):
    """[(group or None, payload)] of one task: a split makes one payload per
    group with that group's files, its paired inputs, its parameter values and
    its output names. Formulas are left to apply_formulas, after value
    connections are applied."""
    from copy import deepcopy
    split = payload.get('split')
    if not split or not (split.get('by') or []):
        return [(None, deepcopy(payload))]
    errors = part_errors(split)
    if errors:
        raise SplitError(' '.join(errors))
    inputs = payload.get('inputs') or {}
    groups = split_groups(inputs.get(split['input'], []), split['by'], files)
    if not groups:
        raise SplitError(f'{split["input"]}: 나눌 파일이 없습니다.')
    paired = {}
    for role, ids in inputs.items():
        if role != split['input'] and len(ids) > 1 and len(groups) > 1:
            paired[role] = pair_files(role, (payload.get('pairing') or {}).get(role), ids, groups, files)
    runs = []
    for group in groups:
        each = deepcopy(payload)
        each['inputs'] = {role: group['files'] if role == split['input'] else paired[role][group['id']] if role in paired else list(ids)
                          for role, ids in inputs.items()}
        for key, values in (payload.get('groupValues') or {}).items():
            if group['id'] in values and str(values[group['id']]).strip() != '':
                set_parameter(each, key, values[group['id']])
        runs.append((group, group_outputs(spec, each, group['suffix'] if len(groups) > 1 else '')))
    return runs


def set_parameter(payload, key, value):
    owner, _, name = key.rpartition('.')
    if owner:
        payload.setdefault('parameterSets', {}).setdefault(owner, {})[name] = value
    else:
        payload.setdefault('parameters', {})[name] = value


def parameter(payload, name):
    """A task's parameter by `name` or `pset.name`; a bare name may live in a pset."""
    owner, _, bare = name.rpartition('.')
    if owner:
        return (payload.get('parameterSets') or {}).get(owner, {}).get(bare)
    if name in (payload.get('parameters') or {}):
        return payload['parameters'][name]
    return next((values[name] for values in (payload.get('parameterSets') or {}).values() if name in values), None)


def apply_formulas(payload):
    """Write each formula's value into its parameter, reading the task's
    other parameters as they are now (`3 * fwhmpsf`)."""
    formulas = {k: v for k, v in (payload.get('formulas') or {}).items() if str(v).strip()}
    done, pending = {}, dict(formulas)
    for _ in range(len(pending) + 1):
        for key, text in list(pending.items()):
            names = expression_names(text)
            waiting = {k for k in pending if k != key} | {k.rpartition('.')[2] for k in pending if k != key}
            if any(n in waiting for n in names):
                continue
            variables = {}
            for name in names:
                value = parameter(payload, name)
                number = _number(value)
                if number is None:
                    raise SplitError(f'{key}: {name} 값이 수치가 아닙니다.')
                variables[name] = [number]
            result = evaluate_expression(text, variables)
            if len(result) != 1 or _number(result[0]) is None:
                raise SplitError(f'{key}: 식의 값이 수치 하나가 아닙니다.')
            value = float(result[0])
            set_parameter(payload, key, int(value) if value.is_integer() else round(value, 6))
            done[key] = value
            del pending[key]
    if pending:
        raise SplitError(f'{", ".join(pending)}: 식이 서로를 참조합니다.')
    return payload


def without_fields(payload):
    """The payload IRAF validation reads."""
    return {k: v for k, v in payload.items() if k not in FIELDS}
