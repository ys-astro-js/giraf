"""Values that flow along value connections into task parameters (docs/node-schema.md).

A value is a list of numbers or strings. It comes from a task's `value-output`
component (a text column or a header keyword of its output), or a GIRAF value
node (`value-constant`, `value-header`, `value-compute`, or a `pset` node's
parameter). Values reach a task parameter as one scalar. A task split into
groups (giraf/splits.py) runs once per group; a group of another split task
with the same id reads that group's run (giraf/workflow.py group_scope).

The request shape is shared by the `/api/values` endpoint and workflow runs:

  nodes: [{id, run, rows: [{name, value, type?}], files: [file id],
           fileLinks: [{source, sourceRole?, sourceFiles?}], inputs: {variable: ref}}]
  links: [{id, target, parameter, type, source: ref, groups?: [group id]}]
  ref:   {node, output}
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


def same_value(a, b):
    """Header values as a split compares them: as numbers when both read as
    one (15 is 15.0), otherwise as trimmed text."""
    x, y = _number(a), _number(b)
    return x == y if x is not None and y is not None else str(a).strip() == str(b).strip()


def pass_value(text):
    """A header value as people read it and output names take it: a whole
    number without decimals (15.0 is 15), otherwise the trimmed text (30.66011, B)."""
    text = str(text).strip()
    number = _number(text)
    return str(int(number)) if number is not None and number.is_integer() else text


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
    values = []
    for product in products:
        path = _product_path(product, resolve_file)
        if 'keyword' in spec:
            value = header_value(path, spec['keyword'])
            if value is not None:
                values.append(value)
            continue
        values += column_values(path.read_text(errors='replace'), spec['column'], kind)
    return dict(kind=kind, values=values, origin=definition.get('taskName') or None)


def constant_value(row):
    """A user-typed value."""
    number = _number(row.get('value'))
    text = str(row.get('value', '')).strip()
    return dict(kind='real' if number is not None else 'string',
                values=[number if number is not None else text] if text else [], constant=True)


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


def header_values(files, keyword):
    """A keyword of each file (paths)."""
    values = [value for value in (header_value(path, keyword) for path in files) if value is not None]
    return dict(kind='real' if values and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values) else 'any',
                values=values)


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


def compute_value(row, inputs):
    """One `name = expression` row of a compute node."""
    constant = all(v.get('constant') for v in inputs.values())
    values = evaluate_expression(row['value'], {k: v['values'] for k, v in inputs.items()})
    return dict(kind=_kind(values), values=values, **({'constant': True} if constant else {}))


def _kind(values):
    return 'bool' if values and all(isinstance(v, bool) for v in values) else 'real'


def parameter_value(result, type_):
    """The one value a parameter takes, converted to its IRAF type."""
    values = result['values']
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
        self.request = request
        self.nodes = {n['id']: n for n in request.get('nodes', [])}
        self.links = list(request.get('links', []))
        self.job_of, self.resolve_file = job_of, resolve_file
        self.cache = {}

    def scoped(self, jobs):
        """The same values read from other runs of some tasks (a group's own, giraf/workflow.py group_scope)."""
        return ValueGraph(self.request, lambda id: jobs[id] if id in jobs else self.job_of(id), self.resolve_file)

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
            return constant_value(rows[name])
        if run == 'value-header':
            return header_values(self.files(node), name)
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
        """The path of each file a header node reads."""
        from .workflow import matches_files
        paths = [Path(self.resolve_file(id)) for id in node.get('files', [])]
        for link in node.get('fileLinks', []):
            job = self.job_of(link['source'])
            if not job or job.get('state') != 'completed':
                raise ValueError('파일을 넘겨줄 작업을 먼저 실행해 주세요.')
            for product in job.get('products', []):
                if (product.get('role') != '$log' and product.get('asset', 'image') == 'image'
                        and (not link.get('sourceRole') or product.get('role') == link['sourceRole'])
                        and matches_files(product, link.get('sourceFiles'))):
                    paths.append(_product_path(product, self.resolve_file))
        return paths

    def parameters(self, target=None, groups=None):
        """{link id: {value} or {error}} for the links into `target` (or all).

        A link listing `groups` (a split task's group ids) also gets one value
        per group, `<link id>@<group id>`, read from the runs `groups` gives
        for that group id ({task id: {group id: job}}).
        """
        result = {}
        for link in self.links:
            if target is not None and link['target'] != target:
                continue
            result[link['id']] = self._parameter(link)
            for group in link.get('groups') or []:
                scoped = self.scoped({id: jobs[group] for id, jobs in (groups or {}).items() if group in jobs})
                result[f"{link['id']}@{group}"] = scoped._parameter(link)
        return result

    def _parameter(self, link):
        try:
            return dict(value=parameter_value(self.output(link['source']), link.get('type', 's')))
        except (ValueError, OSError, KeyError) as exc:
            return dict(error=str(exc))

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


INTERNAL = ('origin', 'constant')


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
