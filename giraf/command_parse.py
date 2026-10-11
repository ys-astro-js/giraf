"""Read IRAF CL commands as people type them, using the installed `.par` knowledge.

This is the reverse of giraf/commands.py: text in, and for each command the
task, the parameters it sets and the files it reads and writes. Nothing runs.
The rules follow the CL's command mode (pkg/language/doc/commands.hlp):

    taskname arg1 ... argN par=val ... par=val redir

- Positional arguments fill the task's parameters in `.par` (or procedure
  declaration) order; hidden parameters take values only by keyword, and more
  positional arguments than parameters is an error (commands.hlp,
  "Arguments").
- `par+` / `par-` set a boolean (commands.hlp, "switch" syntax).
- Strings may be quoted; in command mode unquoted words are strings.
- `> file` sends the standard output to a file (commands.hlp, "I/O
  Redirection").
- Task and parameter names may be abbreviated to any unique prefix
  (cl.hlp, `abbreviate = yes`); an exact name wins over longer ones.
  Enumerated string values minimum-match their choices (params.hlp).
- `pset.param=value` sets a parameter of one of the task's psets; a line
  `pset.param = value` (or `task.param = value`) sets it for the lines that
  follow, as the CL's parameter assignment does (params.hlp); `unlearn`
  drops those.
- A trailing `\\` continues the command on the next line, and `#` starts a
  comment.
- `@file` names a list file; `a,b` is a list of names; `*`, `?` and `[1-5]`
  are filename templates.

Shell lines `ls PATTERN > X.list` define a list file: a later `@X.list` reads
the files the shell would have listed then, earlier outputs included. Lines
that load a package, CL builtins (pkg/language/doc), the `system` package's
file utilities and shell programs are not task invocations and are returned
as skipped. Which task a name means follows the packages the earlier lines
loaded, latest first, as the CL searches loaded packages.
"""
from __future__ import annotations

import fnmatch
import os
import re
import shutil
from functools import lru_cache
from pathlib import Path

from .products import IMAGE_SUFFIXES

IDENT = re.compile(r'^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$')
KEYWORD = re.compile(r'^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)=(.*)$', re.S)
SWITCH = re.compile(r'^([A-Za-z_][\w.]*)([+-])$')
REDIRECT = re.compile(r'^(>>?&?|>>?[GIP])(.*)$')
TEMPLATE = re.compile(r'[*?]|\[[^\]:,]*\]')
NOT_PARAMETERS = {'mode', '$nargs'}


class ParseError(ValueError):
    pass


# ---------------------------------------------------------------- catalog


@lru_cache(maxsize=1)
def language_builtins():
    """The CL's own commands: the language package's help pages."""
    from .task_capabilities import installed_root
    root = installed_root()
    docs = root / 'pkg' / 'language' / 'doc' if root else None
    return frozenset(p.stem for p in docs.glob('*.hlp')) if docs and docs.is_dir() else frozenset()


class Catalog:
    """The task catalog as the parser reads it: names, packages, parameters."""

    def __init__(self, tasks, snapshot, builtins=()):
        self.tasks = tasks
        self.snapshot = snapshot
        self.builtins = set(builtins)
        self.short = {}
        packages = set()
        for key, spec in tasks.items():
            self.short.setdefault(spec.get('taskName') or key, []).append(key)
            parts = spec.get('package', '').split('.')
            if parts[0]:
                packages.update('.'.join(parts[:i + 1]) for i in range(len(parts)))
        self.packages = sorted(packages)
        self.psets = {}
        for key in tasks:
            for pset in self.parameter_sets(key):
                if pset['name'] != '$package':
                    self.psets.setdefault(pset['name'], pset)

    def parameters(self, key):
        """The task's own parameters in `.par` order."""
        spec = self.tasks[key]
        rows = spec.get('allParameters') if spec.get('adapter') == 'generic' else self.snapshot['tasks'].get(key)
        return [p for p in rows or spec.get('parameters', [])
                if p['name'] not in NOT_PARAMETERS and p.get('type') != 'pset']

    def parameter_sets(self, key):
        """[{name, task, parameters, target}] the task also reads: its psets
        and, for a CCD adapter, the ccdproc it runs first and its package."""
        spec = self.tasks[key]
        if spec.get('adapter') == 'generic':
            return [dict(name=s['name'], task=s.get('task', s['name']).split('.')[-1],
                         parameters=s.get('allParameters') or s['parameters'], target='parameterSets')
                    for s in spec.get('parameterSets', [])]
        sets = []
        if spec.get('preprocess') and 'ccdproc' in self.snapshot['tasks']:
            sets.append(dict(name='ccdproc', task='ccdproc', target='preprocess',
                             parameters=[p for p in self.snapshot['tasks']['ccdproc'] if p['name'] not in NOT_PARAMETERS]))
        package = spec.get('package', '').split('.')[-1]
        if package in self.snapshot['tasks']:
            sets.append(dict(name='$package', task=package, target='packageValues',
                             parameters=[p for p in self.snapshot['tasks'][package] if p['name'] not in NOT_PARAMETERS]))
        return sets

    def ports(self, key):
        """({input name: slot}, {output name: slot}) of the task's node."""
        spec = self.tasks[key]
        inputs = {s['name']: s for s in spec.get('inputs', [])}
        if spec.get('adapter') == 'generic':
            outputs = {s['name']: s for s in spec.get('outputs', []) if s.get('mode') != 'pass'}
        else:
            out = spec.get('output')
            outputs = {out['name']: dict(out, kind=spec.get('kind', 'image'))} if out and out['mode'] != 'edit' else {}
        return inputs, outputs

    def preprocess_inputs(self, key):
        """File parameters of the ccdproc a CCD adapter runs first: inputs of its node."""
        spec = self.tasks[key]
        if spec.get('adapter') == 'generic' or not spec.get('preprocess'):
            return set()
        ccdproc = self.tasks.get('ccdproc') or {}
        return {s['name'] for s in ccdproc.get('inputs', [])[1:]}


def default_catalog():
    from .task_catalog import SNAPSHOT, TASKS, _catalog_lock
    with _catalog_lock:
        return Catalog(dict(TASKS), SNAPSHOT, language_builtins())


def minimum_match(word, names):
    """cl.hlp `abbreviate`: the exact name, else every name `word` begins."""
    if word in names:
        return [word]
    return [n for n in names if n.startswith(word)]


# ---------------------------------------------------------------- text


def statements(text):
    """[(first line number, text)] with comments dropped and `\\` lines joined."""
    result, pending, start = [], '', None
    for number, raw in enumerate(text.splitlines(), 1):
        line = _strip_comment(raw).rstrip()
        if start is None:
            start = number
        if line.endswith('\\'):
            pending += line[:-1] + ' '
            continue
        pending += line
        if pending.strip():
            result.append((start, pending.strip()))
        pending, start = '', None
    if pending.strip():
        result.append((start, pending.strip()))
    return result


def _strip_comment(line):
    quote = None
    for i, ch in enumerate(line):
        if quote:
            if ch == quote:
                quote = None
        elif ch in '"\'':
            quote = ch
        elif ch == '#':
            return line[:i]
    return line


def tokens(text):
    """Words split on blanks outside quotes, quotes kept; `a = b` joins to `a=b`."""
    words, word, quote, started = [], '', None, False
    for ch in text:
        if quote:
            word += ch
            if ch == quote:
                quote = None
        elif ch in '"\'':
            quote, started = ch, True
            word += ch
        elif ch.isspace():
            if started:
                words.append(word)
            word, started = '', False
        else:
            word += ch
            started = True
    if quote:
        raise ParseError('따옴표가 닫히지 않았습니다.')
    if started:
        words.append(word)
    # `par = val`, `par= val` and `par =val` are `par=val`.
    joined = []
    for word in words:
        last = joined[-1] if joined else ''
        if last and IDENT.match(last) and word.startswith('='):
            joined[-1] = last + word
        elif last.endswith('=') and IDENT.match(last[:-1]) and not keyword(word):
            joined[-1] = last + word
        else:
            joined.append(word)
    return joined


def unquote(word):
    """(text, quoted) of a word."""
    if len(word) >= 2 and word[0] == word[-1] and word[0] in '"\'':
        return word[1:-1], True
    return word, False


def keyword(word):
    """(name, value, quoted) of a `par=value` word, or None."""
    match = KEYWORD.match(word)
    if not match:
        return None
    value, quoted = unquote(match.group(2))
    return match.group(1), value, quoted


def split_list(text):
    """A comma list, keeping commas inside brackets (image sections)."""
    items, depth, item = [], 0, ''
    for ch in text:
        if ch == '[':
            depth += 1
        elif ch == ']':
            depth = max(0, depth - 1)
        if ch == ',' and not depth:
            items.append(item.strip())
            item = ''
        else:
            item += ch
    items.append(item.strip())
    return [i for i in items if i]


def image_stem(name):
    """`Zero.fits` and `Zero` name one image."""
    suffix = Path(name).suffix
    return name[:-len(suffix)] if suffix and suffix.lower() in IMAGE_SUFFIXES + ('.imh',) else name


def product_label(name, kind):
    """The file a run makes for an output written `name` (giraf/products.py product_name)."""
    return name if kind != 'image' or Path(name).suffix.lower() in IMAGE_SUFFIXES else name + '.fits'


# ---------------------------------------------------------------- parser


class Parser:
    def __init__(self, catalog, files=(), folder=None, hint=None, resolve=True):
        self.catalog = catalog
        self.files = sorted(files)
        self.folder = Path(folder) if folder else None
        self.hint = hint
        self.resolve = resolve
        self.loaded = []          # package paths, in loading order
        self.assignments = []     # standalone `x.param = value`, in order
        self.lists = {}           # list file -> [(label, line index it was listed at)]
        self.produced = []        # [(line index, role, label)]
        self.lines = []

    def parse(self, text):
        for number, statement in statements(text):
            entry = dict(index=len(self.lines), line=number, text=statement, issues=[])
            self.lines.append(entry)
            try:
                self.statement(entry, statement)
            except ParseError as exc:
                entry.setdefault('kind', 'unknown')
                entry['issues'].append(str(exc))
        for entry in self.lines:
            if entry.get('kind') == 'assign' and not entry['applied']:
                entry['issues'].append('뒤의 어떤 작업도 이 값을 쓰지 않습니다.')
            entry['issues'] = list(dict.fromkeys(entry['issues']))
        return dict(lines=self.lines)

    def statement(self, entry, text):
        if text.startswith('!'):
            words = tokens(text[1:])
            if words and words[0] == 'ls' and any(w.startswith('>') for w in words):
                return self.list_definition(entry, words)
            return entry.update(kind='skip', reason='셸 명령')
        words = tokens(text)
        if words and words[-1] == '&':
            words = words[:-1]
        if not words:
            return entry.update(kind='skip', reason='빈 명령')
        if any(w in ('|', '|&') for w in words):
            return entry.update(kind='skip', reason='파이프는 지원하지 않습니다')
        head, quoted = unquote(words[0])
        if head == 'ls':
            return self.list_definition(entry, words)
        assigned = keyword(words[0])
        if len(words) == 1 and assigned and '.' in assigned[0]:
            return self.assignment(entry, *assigned)
        if quoted:
            raise ParseError(f'{head}: 설치된 작업이 아닙니다.')
        if '.' in head:
            package = self.package(head)
            if package:
                return self.load(entry, package)
        task = self.task(head, entry)
        if task is not None:
            self.invocation(entry, task, words[1:])

    # -- packages and tasks

    def package(self, word):
        """The package path a word loads (`noao.digi` is noao.digiphot), or None."""
        path = None
        for part in word.split('.'):
            names = {}
            for p in self.catalog.packages:
                # The first name may be any package, as the CL loads it by name.
                if path is None or (p.startswith(path + '.') and p.count('.') == path.count('.') + 1):
                    names.setdefault(p.rsplit('.', 1)[-1], []).append(p)
            found = minimum_match(part, list(names))
            if len(found) != 1 or len(names[found[0]]) != 1:
                return None
            path = names[found[0]][0]
        return path

    def load(self, entry, path):
        self.loaded.append(path)
        entry.update(kind='package', package=path)

    def task(self, word, entry):
        """The catalog key `word` names, or None once the line is marked."""
        catalog = self.catalog
        if self.hint in catalog.tasks:
            short = catalog.tasks[self.hint].get('taskName') or self.hint
            if short.startswith(word):
                return self.hint
        shorts = minimum_match(word, list(catalog.short))
        package = self.package(word)
        if package and (not shorts or package.rsplit('.', 1)[-1] == word and word not in catalog.short):
            self.load(entry, package)
            return None
        if word not in catalog.short:
            if word in catalog.builtins:
                entry.update(kind='skip', reason='CL 명령')
                if word == 'unlearn':
                    self.unlearn(entry)
                return None
            # `vi`, `ds9`: a program by that very name is not an abbreviated task.
            if shutil.which(word):
                return entry.update(kind='skip', reason='셸 명령')
        if not shorts:
            raise ParseError(f'{word}: 설치된 작업이 아닙니다.')
        if len(shorts) > 1:
            raise ParseError(f'{word}: {", ".join(sorted(shorts)[:6])} 중 어느 작업인지 알 수 없습니다.')
        keys = catalog.short[shorts[0]]
        key = self.in_loaded(keys)
        if key is None:
            packages = ', '.join(sorted(catalog.tasks[k]['package'] for k in keys))
            raise ParseError(f'{shorts[0]}: 어느 패키지의 작업인지 알 수 없습니다. 패키지를 먼저 불러오세요({packages}).')
        # GIRAF runs each task in its own run folder; the system package's
        # file utilities (delete, copy, ...) have nothing there to act on.
        if catalog.tasks[key].get('package', '').split('.')[0] == 'system':
            return entry.update(kind='skip', reason='파일 관리 명령')
        return key

    def in_loaded(self, keys):
        """Of tasks with one name, the one in the package loaded last."""
        if len(keys) == 1:
            return keys[0]
        def score(key):
            package = self.catalog.tasks[key]['package']
            return max(((order, path.count('.')) for order, path in enumerate(self.loaded)
                        if package == path or package.startswith(path + '.')), default=None)
        scored = sorted(((score(k), k) for k in keys if score(k) is not None), reverse=True)
        if not scored or len(scored) > 1 and scored[0][0] == scored[1][0]:
            return None
        return scored[0][1]

    def unlearn(self, entry):
        for word in tokens(entry['text'])[1:]:
            name, _ = unquote(word)
            for target in minimum_match(name, list({a['target'] for a in self.assignments})):
                self.assignments = [a for a in self.assignments if a['target'] != target]

    # -- standalone assignment

    def assignment(self, entry, name, value, quoted):
        target, _, parameter = name.rpartition('.')
        targets = {short: ('task', keys) for short, keys in self.catalog.short.items()}
        for pset in self.catalog.psets:
            targets.setdefault(pset, ('pset', pset))
        for key in self.catalog.tasks:
            for pset in self.catalog.parameter_sets(key):
                if pset['name'] == '$package':
                    targets.setdefault(pset['task'], ('package', pset['parameters']))
        found = minimum_match(target, list(targets))
        if len(found) != 1:
            raise ParseError(f'{target}: ' + ('작업이나 pset이 아닙니다.' if not found
                                               else f'{", ".join(sorted(found)[:6])} 중 어느 것인지 알 수 없습니다.'))
        kind, ref = targets[found[0]]
        if kind == 'task':
            rows = self.catalog.parameters(self.in_loaded(ref) or ref[0])
        elif kind == 'pset':
            rows = self.catalog.psets[ref]['parameters']
        else:
            rows = ref
        row = self.parameter(parameter, rows, found[0] + '.')
        text = self.value(row, value, quoted)
        self.assignments = [a for a in self.assignments if not (a['target'] == found[0] and a['parameter'] == row['name'])]
        self.assignments.append(dict(target=found[0], kind=kind, parameter=row['name'], value=text, line=entry['index']))
        entry.update(kind='assign', target=found[0], parameter=row['name'], value=text, applied=[])

    def parameter(self, word, rows, owner=''):
        found = minimum_match(word, [p['name'] for p in rows])
        if not found:
            raise ParseError(f'{owner}{word}: 없는 파라미터입니다.')
        if len(found) > 1:
            raise ParseError(f'{owner}{word}: {", ".join(found[:6])} 중 어느 파라미터인지 알 수 없습니다.')
        return next(p for p in rows if p['name'] == found[0])

    def value(self, row, text, quoted=False):
        """A value as the inspector stores it: booleans `yes`/`no`, enums in full."""
        if row.get('type') == 'b':
            lowered = text.lower()
            if lowered in ('yes', 'y', 'true'):
                return 'yes'
            if lowered in ('no', 'n', 'false'):
                return 'no'
            raise ParseError(f'{row["name"]}: yes 또는 no여야 합니다.')
        choices = [str(c) for c in row.get('choices') or [] if str(c)]
        if choices and text and text[0] not in '@!':
            found = minimum_match(text, choices)
            if len(found) != 1:
                raise ParseError(f'{row["name"]}: {"|".join(choices)} 중 하나여야 합니다.')
            return found[0]
        return text

    # -- invocation

    def invocation(self, entry, key, words):
        catalog = self.catalog
        spec = catalog.tasks[key]
        entry.update(kind='task', task=key, taskName=spec.get('taskName') or key,
                     parameters={}, parameterSets={}, preprocess={}, packageValues={},
                     inputs={}, outputs={})
        rows = catalog.parameters(key)
        psets = catalog.parameter_sets(key)
        positional = [p for p in rows if 'h' not in (p.get('mode') or '')]
        given, redirect, keywords, index, i = {}, None, False, 0, 0
        while i < len(words):
            word = words[i]
            i += 1
            match = REDIRECT.match(word)
            if match:
                target = match.group(2)
                if not target and i < len(words):
                    target, i = words[i], i + 1
                if match.group(1)[-1] not in 'GIP':
                    redirect = unquote(target)[0]
                continue
            assigned = keyword(word)
            switch = None if assigned else SWITCH.match(word)
            if assigned or switch:
                keywords = True
                name, value, quoted = assigned or (switch.group(1), 'yes' if switch.group(2) == '+' else 'no', False)
                place, row = self.keyword(name, rows, psets)
                if switch and row.get('type') != 'b':
                    raise ParseError(f'{name}{switch.group(2)}: {row["name"]}은 yes/no 파라미터가 아닙니다.')
                if (place, row['name']) in given:
                    raise ParseError(f'{row["name"]}: 한 줄에서 두 번 정했습니다.')
                given[(place, row['name'])] = (row, value, quoted)
                continue
            text, quoted = unquote(word)
            if keywords:
                raise ParseError(f'{text}: 위치 인자는 키워드 앞에 와야 합니다.')
            if index >= len(positional):
                raise ParseError(f'{text}: 인자가 너무 많습니다. {entry["taskName"]}의 위치 인자는 {len(positional)}개입니다.')
            row = positional[index]
            given[(None, row['name'])] = (row, text, quoted)
            index += 1
        # Earlier `task.param = value` and `pset.param = value` lines, under this line's own.
        for assignment in self.assignments:
            place = self.assigned_place(key, spec, psets, assignment)
            if place is False:
                continue
            group = rows if place is None else next(p['parameters'] for p in psets if p['name'] == place)
            row = next((p for p in group if p['name'] == assignment['parameter']), None)
            if row is None or (place, row['name']) in given:
                continue
            given[(place, row['name'])] = (row, assignment['value'], True)
            self.lines[assignment['line']]['applied'].append(entry['index'])
        inputs, outputs = catalog.ports(key)
        pre_inputs = catalog.preprocess_inputs(key)
        if redirect is not None:
            if '$stdout' in outputs:
                given[(None, '$stdout')] = (dict(name='$stdout', type='f'), redirect, True)
            else:
                entry['issues'].append(f'{entry["taskName"]}의 출력은 파일로 보낼 수 없습니다.')
        targets = {p['name']: p['target'] for p in psets}
        main = None
        for (place, name), (row, value, quoted) in given.items():
            target = targets.get(place)
            if place is None and name in inputs or target == 'preprocess' and name in pre_inputs:
                entry['inputs'][name] = self.items(value, entry)
                if place is None and name == next(iter(inputs)):
                    main = entry['inputs'][name]
            elif place is None and name in outputs:
                continue
            elif place is None:
                entry['parameters'][name] = self.value(row, value, quoted)
            elif target == 'parameterSets':
                entry['parameterSets'].setdefault(place, {})[name] = self.value(row, value, quoted)
            else:
                entry[target][name] = self.value(row, value, quoted)
        for (place, name), (row, value, quoted) in given.items():
            if place is None and name in outputs and name not in inputs:
                entry['outputs'][name] = self.output(entry, name, value, outputs[name], main)

    def keyword(self, name, rows, psets):
        """(pset name or None, parameter row) a keyword sets."""
        if '.' in name:
            owner, _, parameter = name.rpartition('.')
            names = {p['name']: p for p in psets}
            for p in psets:
                names.setdefault(p['task'], p)
            found = minimum_match(owner, list(names))
            if len(found) != 1:
                raise ParseError(f'{owner}: ' + ('이 작업이 쓰는 pset이 아닙니다.' if not found
                                                  else f'{", ".join(found)} 중 어느 pset인지 알 수 없습니다.'))
            pset = names[found[0]]
            return pset['name'], self.parameter(parameter, pset['parameters'], owner + '.')
        if minimum_match(name, [p['name'] for p in rows]):
            return None, self.parameter(name, rows)
        # giraf/commands.py writes pset parameters by their own names: the CL
        # finds a pset's parameters from the task that uses it.
        found = [(p['name'], r) for p in psets for r in p['parameters'] if r['name'] == name] or \
                [(p['name'], r) for p in psets for r in p['parameters'] if r['name'].startswith(name)]
        if len(found) == 1:
            return found[0]
        if found:
            raise ParseError(f'{name}: {", ".join(f"{p}.{r["name"]}" for p, r in found[:6])} 중 어느 파라미터인지 알 수 없습니다.')
        raise ParseError(f'{name}: 없는 파라미터입니다.')

    def assigned_place(self, key, spec, psets, assignment):
        """Where a standalone assignment lands in this task: None (its own
        parameters), a pset name, or False when the task does not read it."""
        if assignment['kind'] == 'task' and assignment['target'] == (spec.get('taskName') or key):
            return None
        for pset in psets:
            if assignment['kind'] == 'pset' and pset['name'] == assignment['target']:
                return pset['name']
            if assignment['kind'] in ('task', 'package') and pset['task'] == assignment['target']:
                return pset['name']
        return False

    # -- files

    def items(self, text, entry):
        """{text, items: [{name, file?, from?, missing?}]} a file value names."""
        if not self.resolve:
            return dict(text=text, items=[])
        result = []
        for item in split_list(text):
            if item.startswith('@'):
                result += self.list_items(item[1:], entry)
            elif TEMPLATE.search(item):
                found = self.match([item], entry['index'])
                if not found:
                    entry['issues'].append(f'{item}: 맞는 파일이 없습니다.')
                result += found
            else:
                result.append(self.name(item, entry))
        return dict(text=text, items=result)

    def list_items(self, name, entry):
        if name in self.lists:
            listed = self.lists[name]
            if not listed:
                entry['issues'].append(f'@{name}: 목록에 파일이 없습니다.')
            return [self.name(label, entry, before=at) for label, at in listed]
        path = self.folder / name if self.folder else None
        if path and path.is_file():
            return [self.name(line.strip(), entry) for line in path.read_text(errors='replace').splitlines() if line.strip()]
        entry['issues'].append(f'@{name}: 이 목록을 만드는 줄이 없습니다.')
        return [dict(name='@' + name, missing=True)]

    def name(self, name, entry, before=None):
        """A file name: an earlier line's output, else a file in the folder."""
        limit = entry['index'] if before is None else before
        stem = image_stem(name)
        for line, role, label in reversed(self.produced):
            if line < limit and (label == name or image_stem(label) == stem):
                return {'name': name, 'from': dict(line=line, role=role, label=label)}
        for label in self.files:
            if label == name or image_stem(label) == stem:
                return dict(name=name, file=label)
        entry['issues'].append(f'{name}: 폴더의 파일이나 앞 줄의 출력이 아닙니다.')
        return dict(name=name, missing=True)

    def match(self, patterns, before):
        """Shell-glob matches among earlier outputs and folder files, in name order."""
        found, seen = [], set()
        for pattern in patterns:
            hits = [{'name': label, 'from': dict(line=line, role=role, label=label)}
                    for line, role, label in self.produced
                    if line < before and (fnmatch.fnmatchcase(label, pattern) or fnmatch.fnmatchcase(image_stem(label), pattern))]
            hits += [dict(name=label, file=label) for label in self.files if fnmatch.fnmatchcase(label, pattern)]
            for hit in sorted(hits, key=lambda h: h['name']):
                if hit['name'] not in seen:
                    seen.add(hit['name'])
                    found.append(hit)
        return found

    def list_definition(self, entry, words):
        """`ls PATTERN... > X.list`: the files the shell lists at this line."""
        split = next((i for i, w in enumerate(words) if w.startswith('>')), None)
        if split is None:
            return entry.update(kind='skip', reason='셸 명령')
        patterns = [unquote(w)[0] for w in words[1:split] if not w.startswith('-')]
        target = words[split].lstrip('>') or (words[split + 1] if split + 1 < len(words) else '')
        target = unquote(target)[0]
        if not target:
            raise ParseError('목록 파일 이름이 없습니다.')
        entry.update(kind='list', list=target, patterns=patterns, files=[])
        listed = []
        for pattern in patterns:
            hits = self.match([pattern], entry['index'])
            if not hits:
                entry['issues'].append(f'{pattern}: 맞는 파일이 없습니다.')
            for hit in hits:
                if hit['name'] not in entry['files']:
                    entry['files'].append(hit['name'])
                    listed.append((hit['name'], entry['index']))
        self.lists[target] = listed

    def output(self, entry, role, value, slot, main):
        """{text, value, labels}: the node's output name and the files it makes."""
        kind = slot.get('kind', 'image')
        result = dict(text=value, value=value, labels=[])
        if '@' in value:
            # `p@objB90.list`: one output per listed file, prefixed (ccdproc's course use).
            prefix, _, listed = value.partition('@')
            names = [i['name'] for i in self.list_items(listed, entry) if not i.get('missing')] if self.resolve else []
            if prefix:
                result['value'] = prefix
                result['labels'] = [product_label(prefix + Path(n).name, kind) for n in names]
            else:
                result['value'] = None
                entry['issues'].append(f'{value}: 출력 이름의 목록은 입력 이름으로 만들 수 없습니다.')
        elif slot.get('mode') == 'each' and main and len(main['items']) == 1:
            source = main['items'][0]
            label = source.get('file') or source.get('from', {}).get('label') or product_label(source['name'], 'image')
            stem = Path(label).stem
            if stem and stem in value:
                result['value'] = value.replace(stem, '{name}', 1)
            else:
                result['value'] = None
                entry['issues'].append(f'{value}: 입력 이름으로 만들 수 없는 출력 이름입니다.')
            result['labels'] = [product_label(value, kind)]
        else:
            result['labels'] = [product_label(n, kind) for n in split_list(value)]
        for label in result['labels']:
            self.produced.append((entry['index'], role, label))
        return result


def folder_files(folder):
    try:
        return sorted(e.name for e in os.scandir(folder) if e.is_file() and not e.name.startswith('.'))
    except OSError:
        return []


def parse_commands(text, *, folder=None, files=None, task=None, resolve=True, catalog=None):
    """{lines: [...]} for CL command text (see the module docstring)."""
    if not isinstance(text, str):
        raise ValueError('명령 형식이 올바르지 않습니다.')
    if files is None:
        files = folder_files(folder) if folder else []
    return Parser(catalog or default_catalog(), files, folder, task, resolve).parse(text)
