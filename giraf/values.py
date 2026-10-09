"""Values that flow along value connections into task parameters (docs/node-schema.md).

A value is a list of numbers or strings, optionally split by a header keyword
(`groups`). It comes from a task's `value-output` component (a text column
or a header keyword of its output), or a GIRAF value node (`value-constant`,
`value-header`, `value-compute`, or a `pset` node's parameter). Values reach a
task parameter as one scalar; a partitioned target picks its own group's value.
A compute node with a partition splits its inputs by that keyword
(partition_input); values read from files carry their files (`sources`) so
they can be split by each file's header. A table's rows are traced to the
input image its product was made from (`source` or `sourceInput`).

The request shape is shared by the `/api/values` endpoint and workflow runs:

  nodes: [{id, run, rows: [{name, value, groups?, type?}], partition?, files: [file id],
           fileLinks: [{source, sourceRole?, sourceFiles?, sourcePartition?}],
           inputs: {variable: ref}}]
  links: [{id, target, parameter, type, source: ref, partition?: {keyword, value}}]
  ref:   {node, output}

A loop pass sets `partition` to its own values, `{keyword: value}` for each
keyword it runs by (partition_pairs reads both shapes); a value grouped by one
of those keywords takes that keyword's group.
"""
import ast
import math
from pathlib import Path
import re
import statistics

AGGREGATES = ('mean', 'median', 'min', 'max', 'stddev', 'sum', 'count')


def _number(text):
    try:
        number = float(text)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _scalar(value):
    """Header and table cells: a finite number when they read as one."""
    if isinstance(value, bool):
        return value
    number = _number(value)
    if number is not None:
        return int(number) if isinstance(value, int) else number
    return str(value).strip()


def table_records(text):
    """(names, rows) of an IRAF text table or a whitespace table with a `#` header.

    APPHOT/DAOPHOT files name their fields on `#N` lines and continue both the
    names and each record with a trailing backslash. Plain tables (daoedit,
    txdump) name their columns on the last comment line before the data.
    """
    names, rows, header, record = [], [], [], ''
    for line in text.splitlines():
        stripped = line.rstrip()
        if stripped.startswith('#N'):
            names += stripped[2:].rstrip('\\').split()
            continue
        if stripped.startswith('#'):
            if not rows and not record:
                header = stripped.lstrip('#').split()
            continue
        if not stripped.strip():
            continue
        record += ' ' + stripped.rstrip('\\')
        if stripped.endswith('\\'):
            continue
        rows.append(record.split())
        record = ''
    if record.strip():
        rows.append(record.split())
    if not names and rows and len(header) == len(rows[0]):
        names = header
    return names, rows


def column_values(text, column, kind='real'):
    names, rows = table_records(text)
    if isinstance(column, int):
        index = column - 1
    else:
        upper = [n.upper() for n in names]
        if str(column).upper() not in upper:
            raise ValueError(f'{column}: 표에 없는 열입니다.')
        index = upper.index(str(column).upper())
    values = []
    for row in rows:
        if index >= len(row):
            continue
        cell = row[index]
        if kind in ('real', 'int'):
            number = _number(cell)
            if number is not None:  # INDEF and other missing cells are skipped.
                values.append(number)
        else:
            values.append(cell)
    return values


def header_value(path, keyword):
    from astropy.io import fits
    header = fits.getheader(path)
    if keyword not in header:
        return None
    return _scalar(header[keyword])


def _product_path(product, resolve_file):
    path = product.get('path')
    if path and Path(path).is_file():
        return Path(path)
    return Path(resolve_file(product['id']))


def task_value(job, name, resolve_file):
    """A `value-output` of a finished task run, read from its products."""
    if not job or job.get('state') != 'completed':
        raise ValueError('작업을 먼저 실행해 주세요.')
    definition = (job.get('manifest') or {}).get('definition') or {}
    spec = next((v for v in definition.get('values', []) if v['name'] == name), None)
    if not spec:
        raise ValueError(f'{name}: 작업 스키마에 없는 값입니다.')
    products = [p for p in job.get('products', []) if p.get('role') == spec['from']]
    kind = spec.get('kind', 'real')
    inputs = {r['id']: r.get('path') for r in (job.get('manifest') or {}).get('rows', [])}
    values, sources, traced = [], [], True
    for product in products:
        path = _product_path(product, resolve_file)
        if 'keyword' in spec:
            value = header_value(path, spec['keyword'])
            if value is not None:
                values.append(value)
                sources.append(str(path))
            continue
        column = column_values(path.read_text(errors='replace'), spec['column'], kind)
        values += column
        # A table's rows come from the input image it was made from, when the run
        # recorded one: a per-image output (`source`) or a run over one image.
        source = _input_path(product.get('source') or product.get('sourceInput'), inputs, resolve_file)
        traced = traced and source is not None
        sources += [source] * len(column)
    trace = dict(sources=sources) if traced else {}
    return dict(kind=kind, values=values, origin=definition.get('taskName') or None, **trace)


def _input_path(id, inputs, resolve_file):
    """The input file a run read as `id`, or None when it is not known."""
    if not id:
        return None
    path = inputs.get(id)
    if path and Path(path).is_file():
        return str(path)
    try:
        return str(resolve_file(id))
    except (ValueError, OSError, KeyError):
        return None


def _group_by(keyed, keyword):
    groups = {}
    for key, value in keyed:
        groups.setdefault(key, []).append(value)
    return dict(keyword=keyword, values=groups)


def constant_value(node, row):
    """A user-typed value; with a partition keyword, one value per group."""
    def typed(text):
        number = _number(text)
        return number if number is not None else str(text).strip()
    result = dict(kind='real' if _number(row.get('value')) is not None else 'string',
                  values=[typed(row.get('value', ''))] if str(row.get('value', '')).strip() else [], constant=True)
    groups = {k: [typed(v)] for k, v in (row.get('groups') or {}).items() if str(v).strip()}
    if node.get('partition') and groups:
        result['groups'] = dict(keyword=node['partition'], values=groups)
        result['values'] = [v for vs in groups.values() for v in vs]
        result['kind'] = 'real' if all(isinstance(v, float) for v in result['values']) else 'string'
    return result


PSET_KINDS = {'r': 'real', 'd': 'real', 'i': 'int', 'b': 'bool'}


def pset_value(row):
    """A parameter a pset node holds, typed by its IRAF type (`type`: r, d, i, b, s, f)."""
    text = str(row.get('value', '')).strip()
    kind = PSET_KINDS.get(row.get('type'), 'string')
    if kind == 'string':
        return dict(kind=kind, values=[text], constant=True)
    if not text:
        return dict(kind=kind, values=[], constant=True)
    if text.upper() == 'INDEF':
        value = 'INDEF'
    elif kind == 'bool':
        if text.lower() not in ('yes', 'no', 'true', 'false'):
            raise ValueError(f'{row["name"]}: {text}은 yes 또는 no가 아닙니다.')
        value = text.lower() in ('yes', 'true')
    else:
        number = _number(text)
        if number is None:
            raise ValueError(f'{row["name"]}: {text}은 수치가 아닙니다.')
        value = int(number) if kind == 'int' else number
    return dict(kind=kind, values=[value], constant=True)


def header_values(paths, keyword, partition=None):
    values, keyed, sources = [], [], []
    for path in paths:
        value = header_value(path, keyword)
        if value is None:
            continue
        values.append(value)
        sources.append(str(path))
        if partition:
            group = header_value(path, partition)
            keyed.append((str(group if group is not None else '').strip(), value))
    result = dict(kind='real' if values and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values) else 'any',
                  values=values, sources=sources)
    if partition:
        result['groups'] = _group_by(keyed, partition)
    return result


# IRAF expressions (hselect's expr) use C operators; Python's grammar reads the rest.
def _python_expression(text):
    text = re.sub(r'&&', ' and ', text)
    text = re.sub(r'\|\|', ' or ', text)
    text = re.sub(r'!(?!=)', ' not ', text)
    return text.strip()


def _aggregate(name, values):
    values = [v for v in values if v is not None]
    if not values:
        raise ValueError(f'{name}: 값이 없습니다.')
    if name == 'stddev':
        return statistics.stdev(values) if len(values) > 1 else 0.0
    return {'mean': statistics.fmean, 'median': statistics.median, 'min': min, 'max': max,
            'sum': math.fsum, 'count': len}[name](values)


FUNCTIONS = {'abs': abs, 'sqrt': math.sqrt, 'exp': math.exp, 'log': math.log, 'log10': math.log10,
             'sin': math.sin, 'cos': math.cos, 'tan': math.tan, 'nint': round, 'int': int,
             'real': float, 'double': float}


def evaluate_expression(text, variables):
    """Evaluate an IRAF-style arithmetic expression over value lists.

    Arithmetic applies element by element (a one-value list broadcasts);
    `mean`, `median`, `min`, `max`, `stddev`, `sum`, `count` reduce a list to
    one value. Only these operations are allowed; there is no code execution.
    """
    try:
        tree = ast.parse(_python_expression(text), mode='eval')
    except SyntaxError as exc:
        raise ValueError(f'{text}: 식을 읽지 못했습니다.') from exc

    def lists(*items):
        size = max(len(i) for i in items)
        if any(len(i) not in (1, size) for i in items):
            raise ValueError('값 목록의 개수가 서로 다릅니다.')
        return [[i[0] if len(i) == 1 else i[k] for i in items] for k in range(size)]

    def run(node):
        if isinstance(node, ast.Expression):
            return run(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            return [float(node.value)]
        # Quoted text compares with header strings (`IMAGETYP == "object"`).
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return [node.value]
        if isinstance(node, ast.Name):
            if node.id not in variables:
                raise ValueError(f'{node.id}: 연결되지 않은 값입니다.')
            return list(variables[node.id])
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd, ast.Not)):
            op = {ast.USub: lambda a: -a, ast.UAdd: lambda a: +a, ast.Not: lambda a: not a}[type(node.op)]
            return [op(a) for a in run(node.operand)]
        if isinstance(node, ast.BinOp):
            ops = {ast.Add: lambda a, b: a + b, ast.Sub: lambda a, b: a - b, ast.Mult: lambda a, b: a * b,
                   ast.Div: lambda a, b: a / b, ast.Pow: lambda a, b: a ** b, ast.Mod: lambda a, b: a % b}
            if type(node.op) not in ops:
                raise ValueError(f'{text}: 지원하지 않는 연산입니다.')
            return [ops[type(node.op)](a, b) for a, b in lists(run(node.left), run(node.right))]
        if isinstance(node, ast.BoolOp):
            parts = [run(v) for v in node.values]
            combine = all if isinstance(node.op, ast.And) else any
            return [combine(bool(x) for x in row) for row in lists(*parts)]
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            ops = {ast.Lt: lambda a, b: a < b, ast.LtE: lambda a, b: a <= b, ast.Gt: lambda a, b: a > b,
                   ast.GtE: lambda a, b: a >= b, ast.Eq: lambda a, b: a == b, ast.NotEq: lambda a, b: a != b}
            if type(node.ops[0]) not in ops:
                raise ValueError(f'{text}: 지원하지 않는 비교입니다.')
            return [ops[type(node.ops[0])](a, b) for a, b in lists(run(node.left), run(node.comparators[0]))]
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and not node.keywords:
            name = node.func.id
            args = [run(a) for a in node.args]
            if name in AGGREGATES:
                # min/max with several arguments compare element by element, as in IRAF.
                if name in ('min', 'max') and len(args) > 1:
                    return [(min if name == 'min' else max)(row) for row in lists(*args)]
                if len(args) != 1:
                    raise ValueError(f'{name}: 값 목록 하나가 필요합니다.')
                return [float(_aggregate(name, args[0]))]
            if name in FUNCTIONS and len(args) == 1:
                return [FUNCTIONS[name](a) for a in args[0]]
            raise ValueError(f'{name}: 지원하지 않는 함수입니다.')
        raise ValueError(f'{text}: 지원하지 않는 식입니다.')

    try:
        return run(tree)
    except (ArithmeticError, TypeError, statistics.StatisticsError) as exc:
        raise ValueError(f'{text}: 계산하지 못했습니다. {exc}') from exc


def expression_names(text):
    try:
        tree = ast.parse(_python_expression(text), mode='eval')
    except SyntaxError:
        return []
    called = {n.func.id for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    return list(dict.fromkeys(n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and n.id not in called))


MIXED_PARTITIONS = '나누기 기준이 다른 값은 함께 계산할 수 없습니다.'


def partition_input(result, keyword, read_header=header_value):
    """An input of a compute node split by `keyword` (the node's 나누기 기준).

    Values already split by it pass; one typed constant applies to every
    group; values read from files are split by each file's header. Values
    whose files are unknown (a table column) cannot be split.
    """
    groups = result.get('groups')
    if groups:
        if groups['keyword'] != keyword:
            raise ValueError(MIXED_PARTITIONS)
        return result
    if result.get('constant'):
        return result
    sources = result.get('sources')
    if sources is None or len(sources) != len(result['values']):
        origin = result.get('origin') or '받은'
        raise ValueError(f'{origin} 값은 어느 파일에서 나왔는지 알 수 없어 {keyword}별로 나눌 수 없습니다.')
    keyed = []
    for path, value in zip(sources, result['values']):
        group = read_header(path, keyword)
        keyed.append((str(group if group is not None else '').strip(), value))
    return {**result, 'groups': _group_by(keyed, keyword)}


def compute_value(row, inputs):
    """One `name = expression` row of a compute node, per group when any input is grouped."""
    keyword = next((v['groups']['keyword'] for v in inputs.values() if v.get('groups')), None)
    if keyword and any(v.get('groups') and v['groups']['keyword'] != keyword for v in inputs.values()):
        raise ValueError(MIXED_PARTITIONS)
    # Typed constants alone give a constant; it applies to every group downstream.
    constant = all(v.get('constant') for v in inputs.values())
    if not keyword:
        values = evaluate_expression(row['value'], {k: v['values'] for k, v in inputs.items()})
        return dict(kind=_kind(values), values=values, **({'constant': True} if constant else {}))
    keys = list(dict.fromkeys(k for v in inputs.values() if v.get('groups') for k in v['groups']['values']))
    groups = {}
    for key in keys:
        groups[key] = evaluate_expression(row['value'], {
            name: (v['groups']['values'].get(key, []) if v.get('groups') else v['values']) for name, v in inputs.items()})
    values = [v for vs in groups.values() for v in vs]
    return dict(kind=_kind(values), values=values, groups=dict(keyword=keyword, values=groups))


def _kind(values):
    return 'bool' if values and all(isinstance(v, bool) for v in values) else 'real'


def partition_pairs(partition):
    """{keyword: value} of a partition: one port member's `{keyword, value}`,
    or a loop pass's values by keyword."""
    if not partition:
        return {}
    if set(partition) == {'keyword', 'value'}:
        return {partition['keyword']: partition['value']}
    return dict(partition)


def parameter_value(result, partition, type_):
    """The one value a parameter takes, converted to its IRAF type."""
    values = result['values']
    groups = result.get('groups')
    pairs = partition_pairs(partition)
    if groups and groups['keyword'] in pairs:
        value = pairs[groups['keyword']]
        if value not in groups['values']:
            raise ValueError(f'{groups["keyword"]}={value}: 이 그룹의 값이 없습니다.')
        values = groups['values'][value]
    if not values:
        raise ValueError('값이 없습니다.')
    distinct = list(dict.fromkeys(values))
    if len(distinct) > 1:
        raise ValueError(f'값이 {len(values)}개입니다. 계산 노드에서 하나로 모아 주세요.')
    value = distinct[0]
    if value == 'INDEF' and type_ in ('r', 'd', 'i'):
        return 'INDEF'  # IRAF's undefined number, as a pset row may hold it.
    if type_ in ('r', 'd', 'i'):
        number = 1.0 if value is True else 0.0 if value is False else _number(value)
        if number is None:
            raise ValueError(f'{value}: 수치가 아닙니다.')
        return int(round(number)) if type_ == 'i' else number
    if type_ == 'b':
        if isinstance(value, bool):
            return 'yes' if value else 'no'
        if str(value).strip().lower() in ('yes', 'no'):
            return str(value).strip().lower()
        number = _number(value)
        if number is None:
            raise ValueError(f'{value}: yes 또는 no가 아닙니다.')
        return 'yes' if number else 'no'
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


class ValueGraph:
    """Evaluate value refs of one request with memoization.

    `job_of(node_id)` returns the finished job of a task node (or None);
    `resolve_file(id)` returns the path of a library file or product.
    """

    def __init__(self, request, job_of, resolve_file):
        self.nodes = {n['id']: n for n in request.get('nodes', [])}
        self.links = list(request.get('links', []))
        self.job_of, self.resolve_file = job_of, resolve_file
        self.cache = {}

    def output(self, ref, seen=()):
        key = (ref['node'], ref['output'])
        if key in self.cache:
            return self.cache[key]
        # A value that comes to read itself is a cycle; one node's other values may feed it.
        if key in seen:
            raise ValueError('값 연결이 순환합니다.')
        node = self.nodes.get(ref['node'])
        if node is None:
            result = task_value(self.job_of(ref['node']), ref['output'], self.resolve_file)
        else:
            result = self._node_output(node, ref['output'], (*seen, key))
        self.cache[key] = result
        return result

    def _node_output(self, node, name, seen, rows_seen=()):
        rows = {r['name']: r for r in node.get('rows', [])}
        if name in rows_seen:
            raise ValueError(f'{name}: 식이 서로를 참조합니다.')
        if name not in rows:
            raise ValueError(f'{name}: 노드에 없는 값입니다.')
        run = node['run']
        if run == 'value-constant':
            return constant_value(node, rows[name])
        if run == 'value-header':
            return header_values(self.files(node), name, node.get('partition') or None)
        if run == 'value-compute':
            used = [v for v in expression_names(rows[name]['value']) if v not in rows or v == name]
            local = {v: self._node_output(node, v, (*seen, (node['id'], v)), (*rows_seen, name))
                     for v in expression_names(rows[name]['value']) if v in rows and v != name}
            inputs = {}
            for variable in used:
                ref = node.get('inputs', {}).get(variable)
                if not ref:
                    raise ValueError(f'{variable}: 연결되지 않은 값입니다.')
                inputs[variable] = self.output(ref, seen)
            if node.get('partition'):
                inputs = {k: partition_input(v, node['partition']) for k, v in inputs.items()}
            return compute_value(rows[name], {**inputs, **local})
        if run == 'pset':
            # A value connected into the parameter replaces the stored one.
            ref = node.get('inputs', {}).get(name)
            if ref:
                return self.output(ref, seen)
            return pset_value(rows[name])
        raise ValueError(f'{run}: 값을 계산할 수 없는 노드입니다.')

    def reads(self, node, name):
        """The refs one value of a value node reads: a pset parameter's connected value,
        or the inputs a compute row's expression names, through the rows it reads."""
        run = node.get('run')
        if run == 'pset':
            ref = node.get('inputs', {}).get(name)
            return [ref] if ref else []
        if run == 'value-compute':
            rows = {r['name']: r for r in node.get('rows', [])}
            names, pending, done = [], [name], set()
            while pending:
                row = pending.pop()
                if row in done or row not in rows:
                    continue
                done.add(row)
                for v in expression_names(rows[row]['value']):
                    if v in rows and v != row:
                        pending.append(v)
                    elif v not in names:
                        names.append(v)
            inputs = node.get('inputs', {})
            return [inputs[v] for v in names if v in inputs]
        return list(node.get('inputs', {}).values())

    def files(self, node):
        from .workflow import matches_files, matches_partition
        paths = [Path(self.resolve_file(id)) for id in node.get('files', [])]
        for link in node.get('fileLinks', []):
            job = self.job_of(link['source'])
            if not job or job.get('state') != 'completed':
                raise ValueError('파일을 넘겨줄 작업을 먼저 실행해 주세요.')
            for product in job.get('products', []):
                if (product.get('role') != '$log' and product.get('asset', 'image') == 'image'
                        and (not link.get('sourceRole') or product.get('role') == link['sourceRole'])
                        and matches_files(product, link.get('sourceFiles'))
                        and matches_partition(product, link.get('sourcePartition'))):
                    paths.append(_product_path(product, self.resolve_file))
        return paths

    def parameters(self, target=None):
        """{link id: {value} or {error}} for the links into `target` (or all)."""
        result = {}
        for link in self.links:
            if target is not None and link['target'] != target:
                continue
            try:
                value = parameter_value(self.output(link['source']), link.get('partition'), link.get('type', 's'))
                result[link['id']] = dict(value=value)
            except (ValueError, OSError, KeyError) as exc:
                result[link['id']] = dict(error=str(exc))
        return result

    def outputs(self, refs):
        result = {}
        for ref in refs:
            try:
                result[f'{ref["node"]}:{ref["output"]}'] = public(self.output(ref))
            except (ValueError, OSError, KeyError) as exc:
                result[f'{ref["node"]}:{ref["output"]}'] = dict(error=str(exc))
        return result

    def dependencies(self, target):
        """Task nodes whose runs the values of `target`'s links read."""
        found = set()

        def visit(ref, seen):
            node = self.nodes.get(ref['node'])
            if node is None:
                found.add(ref['node'])
                return
            key = (ref['node'], ref['output'])
            if key in seen:
                return
            seen = seen | {key}
            for link in node.get('fileLinks', []):
                found.add(link['source'])
            for inner in self.reads(node, ref['output']):
                visit(inner, seen)
        for link in self.links:
            if link['target'] == target:
                visit(link['source'], frozenset())
        return found


INTERNAL = ('sources', 'origin', 'constant')


def public(result):
    """A value as the editor sees it, without where its values came from."""
    return {k: v for k, v in result.items() if k not in INTERNAL}


def apply_parameters(payload, links, resolved):
    """Write resolved values into a task payload: `pset.name` keys go to the pset."""
    for link in links:
        outcome = resolved.get(link['id'])
        if outcome is None:
            continue
        if 'error' in outcome:
            raise ValueError(f'{link["parameter"]}: {outcome["error"]}')
        owner, _, name = link['parameter'].rpartition('.')
        if owner:
            payload.setdefault('parameterSets', {}).setdefault(owner, {})[name] = outcome['value']
        else:
            payload.setdefault('parameters', {})[name] = outcome['value']
    return payload
