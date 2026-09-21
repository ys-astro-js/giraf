"""Bounded SPP data-flow analysis for IRAF file contracts.

Trace parameter values through local procedure arguments to file APIs. This is
not a full SPP compiler: unresolved file-bearing calls remain explicit issues,
and partial evidence is usable without claiming that the contract is complete.
"""
import hashlib
import json
from pathlib import Path
import re

ANALYSIS_VERSION = 2


def without_comments(source):
    return re.sub(r'"(?:\\.|[^"\\])*"|#[^\n]*',
                  lambda m: m[0] if m[0].startswith('"') else '', source)


def procedures(source, path):
    pattern = r'^\s*(?:(?:int|real|double|bool|pointer|char)\s+)?procedure\s+(\w+)\s*\((.*?)\)'
    for match in re.finditer(pattern, source, re.M | re.S):
        tail = source[match.end():]
        begin = re.search(r'^begin\s*$', tail, re.M)
        if begin:
            body = re.split(r'^end\s*$', tail[begin.end():], maxsplit=1, flags=re.M)[0]
            yield match[1].lower(), dict(args=[v.strip() for v in match[2].split(',') if v.strip()],
                                         body=body, path=path)


def closing_brace(text, start):
    depth = 0
    quoted = False
    for i in range(start, len(text)):
        if text[i] == '"':
            quoted = not quoted
        if quoted:
            continue
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if not depth:
                return i
    return None


def constant_branches(body, constants):
    """Remove only branches whose simple boolean condition is proven constant."""
    pattern = r'\bif\s*\(\s*(\w+)\s*==\s*(YES|NO)\s*\)\s*\{'
    for match in reversed(list(re.finditer(pattern, body))):
        value = constants.get(match[1])
        if value not in ('YES', 'NO'):
            continue
        end = closing_brace(body, match.end()-1)
        if end is None:
            continue
        suffix = re.match(r'\s*else\s*\{', body[end+1:])
        other_end = closing_brace(body, end+suffix.end()) if suffix else None
        yes = body[match.end():end]
        no = body[end+suffix.end()+1:other_end] if other_end is not None else ''
        body = body[:match.start()] + (yes if value == match[2] else no) + body[(other_end if other_end is not None else end)+1:]
    return body


def analyze_text(parameters, source):
    source = without_comments(source)
    units = dict(procedures(source, '<source>'))
    if not units:
        return _analyze(parameters, {}, None, {})
    return _analyze(parameters, units, next(iter(units)), {'<source>': hashlib.sha256(source.encode()).hexdigest()})


def analyze_source(parameters, entry):
    entry = Path(entry).resolve()
    units = {}
    hashes = {}
    entry_names = []
    def definitions(path, seen=None):
        seen = set() if seen is None else seen
        path = path.resolve()
        if path in seen or not path.is_file():
            return {}, set()
        seen.add(path)
        text = without_comments(path.read_text(errors='replace'))
        hashes[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
        constants, dependencies = {}, {str(path)}
        for include in re.findall(r'^\s*include\s+"([^"]+)"', text, re.M):
            values, files = definitions(path.parent/include, seen)
            constants.update(values)
            dependencies.update(files)
        for name, value in re.findall(r'^\s*define\s+(\w+)\s+("[^"\n]*"|\w+)', text, re.M):
            constants[name] = value
        return constants, dependencies
    for path in sorted(entry.parent.rglob('*.x')):
        source = path.read_text(errors='replace')
        hashes[str(path)] = hashlib.sha256(source.encode()).hexdigest()
        constants, dependencies = definitions(path)
        for name, unit in procedures(without_comments(source), str(path)):
            unit.update(constants=constants, dependencies=dependencies)
            # Duplicate implementations must not be selected by filesystem order.
            units[name] = unit if name not in units else None
            if path == entry:
                entry_names.append(name)
    return _analyze(parameters, units, entry_names[0] if entry_names else None, hashes)


def _analyze(parameters, units, entry, hashes):
    from .task_schema import arguments, calls, file_extension
    pars = {p['name']: p for p in parameters}
    ports, lists, evidence, issues, hints = {}, set(), [], [], []
    used_files, accessed, visited, controls = set(), set(), set(), set()
    cardinality = {}
    constraints = {}
    # Known non-file consumers do not imply an unknown file operation.
    readers = {'imtlen','imtrew','imtclose','fntclsb','clpcls','pargstr','printf','eprintf',
               'fprintf','strmatch','streq','strdic','strlen','nowhite','fnextn','access',
               'imastr','imstats','erract','error','salloc','smark','sfree','malloc','mfree',
               'sscan','gargwrd','strlwr','ctor','imgstr','if','iferr','while','switch','return'}

    def norm(value):
        return re.sub(r'\s+', '', value)

    def record(role, direction, kind, fn, access, path, procedure):
        prior = ports.get(role)
        if prior and prior[0] != direction:
            issues.append(f'{role}: conflicting file directions in {procedure}')
            return
        if prior and prior[1] == 'mask' and kind == 'image':
            kind = 'mask'
        elif prior and prior[1] != kind and {prior[1],kind} != {'image','mask'}:
            issues.append(f'{role}: conflicting file formats in {procedure}')
            return
        ports[role] = (direction, kind)
        evidence.append(dict(parameter=role, source='spp', path=path, procedure=procedure,
                             call=fn, access=access, direction=direction[:-1]))

    def walk(name, bindings, constants, stack=()):
        unit = units.get(name)
        if unit is None:
            return
        key = (name, tuple(sorted(bindings.items())), tuple(sorted(constants.items())))
        if key in visited:
            return
        if name in stack:
            issues.append(f'{name}: recursive procedure cannot be fully analyzed')
            return
        visited.add(key)
        used_files.add(unit['path'])
        used_files.update(unit.get('dependencies', []))
        body = constant_branches(unit['body'], constants)
        values, formats = dict(bindings), {}
        literals = dict(unit.get('constants', {}), **constants)
        bools, list_vars, counts = {}, {}, {}
        formatter = None

        def origin(value):
            value = norm(value)
            if value in values:
                return values[value]
            # Character substrings retain the filename's provenance.
            match = re.fullmatch(r'(\w+)\[\d+(?:\+\d+)?\]', value)
            return values.get(match[1]) if match else None

        def literal(value):
            if value.strip().startswith('"'):
                return value.strip()
            value = norm(value)
            return literals.get(value, value)

        events = [(pos, 'call', (fn,args)) for pos,fn,args in calls(body)]
        for match in re.finditer(r'(?:^|[;\n])\s*(\w+)\s*=\s*(\w+)\s*(?=[;\n])', body):
            events.append((match.start(), 'assign', (match[1], match[2])))
        for pos, kind, item in sorted(events, key=lambda v:v[0]):
            if kind == 'assign':
                left,right=item
                if origin(right): values[left]=origin(right)
                if right in literals or right in ('YES','NO'): literals[left]=literal(right)
                continue
            fn,args=item
            match=re.search(r'(\w+)\s*=\s*$',body[:pos])
            dest=match[1] if match else None
            if fn == 'clgstr' and len(args)>1:
                role=literal(args[0]).strip('"')
                if role in pars:
                    values[norm(args[1])]=role; accessed.add(role)
                    target = norm(args[1])
                    # Explicit dispatch through a dictionary or @ prefix makes
                    # this a native setting with a file alternative.
                    at_file = re.search(re.escape(target)+r"\[1\]\s*==\s*'@'", re.sub(r'\s+', '', body))
                    dictionary = re.search(r'\bstrdic\s*\(\s*'+re.escape(target)+r'\s*,', re.sub(r'\s+', '', body))
                    if at_file or dictionary:
                        controls.add(role)
                        evidence.append(dict(parameter=role, source='spp', path=unit['path'], procedure=name,
                                             representation='option-or-file', call='clgstr'))
            elif fn in ('clgetb','clgeti','clgetr','clgetc','clgwrd') and args:
                role=literal(args[0]).strip('"')
                if role in pars:
                    accessed.add(role)
                    controls.add(role)
                    if fn=='clgetb' and dest: bools[dest]=role
                    if fn=='clgwrd' and len(args)>=4:
                        dictionary=literal(args[3]).strip('"')
                        if dictionary.startswith('|') and dictionary.endswith('|'):
                            constraints[role]=dict(choices=[v for v in dictionary.split('|') if v], prefixes=[], closed=True,
                                                   source='spp', path=unit['path'], procedure=name, call=fn)
            elif fn in ('imtopenp','clpopnu','clpopni','clpopns') and dest and args:
                role=literal(args[0]).strip('"')
                if role in pars:
                    values[dest]=role; lists.add(role); list_vars[dest]=role; accessed.add(role)
            elif fn in ('imtopen','fntopnb') and dest and args and origin(args[0]):
                values[dest]=origin(args[0]); lists.add(origin(args[0])); list_vars[dest]=origin(args[0])
            elif fn in ('imtgetim','clgfil','fntgfnb','imtrgetim') and len(args)>1 and origin(args[0]):
                values[norm(args[2] if fn=='imtrgetim' else args[1])]=origin(args[0])
            elif fn=='imtlen' and dest and args and origin(args[0]):
                counts[dest]=origin(args[0])
            elif fn in ('strcpy','strcat') and len(args)>1:
                target=norm(args[1])
                if origin(args[0]): values[target]=origin(args[0])
                elif fn=='strcpy': values.pop(target,None)
                if fn=='strcat' and literal(args[0]).strip('"')=='.pl': formats[target]='mask'
            elif fn=='sprintf' and args:
                # Only literal filename templates have a known string-transfer
                # contract. Diagnostic sentences do not rename their arguments.
                template=literal(args[2]).strip('"') if len(args)>2 else ''
                formatter=norm(args[0]) if '%s' in template and not re.search(r'\s',template) else None
                if formatter: values.pop(formatter,None)
            elif fn in ('printf','fprintf','eprintf'):
                formatter=None
            elif fn=='strdic' and len(args)>=4 and origin(args[0]):
                role=origin(args[0])
                dictionary=literal(args[3]).strip('"')
                if dictionary.startswith('|') and dictionary.endswith('|'):
                    target=re.escape(norm(args[0]))
                    prefixes=sorted(set(re.findall(target+r"\[1\]==\s*'(.)'", re.sub(r'\s+', '', body))))
                    constraints[role]=dict(choices=[v for v in dictionary.split('|') if v], prefixes=prefixes, closed=False,
                                           source='spp', path=unit['path'], procedure=name, call='strdic')
                    controls.add(role)
            elif fn=='pargstr' and args and formatter and origin(args[0]):
                values[formatter]=origin(args[0])
            elif fn=='mktemp' and len(args)>1:
                values.pop(norm(args[1]),None)
            elif fn=='imstats' and len(args)>2:
                values.pop(norm(args[2]),None)
            elif fn=='aptmpimage' and len(args)>=4 and origin(args[1]):
                role=origin(args[1]); hints.append(dict(name=role,naming='prefix',kind='image',mode='each'))
                evidence.append(dict(parameter=role,source='spp',path=unit['path'],call=fn,direction='output',naming='prefix'))
            elif fn in ('immap','xt_immap','open') and len(args)>1 and origin(args[0]):
                role=origin(args[0]); access=literal(args[1]); filekind=formats.get(norm(args[0]),'text' if fn=='open' else 'image')
                if role in controls:
                    continue
                if access not in ('READ_ONLY','NEW_COPY','NEW_IMAGE','NEW_FILE','APPEND','READ_WRITE'):
                    issues.append(f'{role}: unresolved access mode {access} in {name}');continue
                if access in ('APPEND','READ_WRITE'):
                    # Keep terminal/log settings as native parameters, not input ports.
                    if pars[role].get('default') in ('STDOUT','STDERR'):
                        controls.add(role)
                        continue
                    issues.append(f'{role}: in-place access in {name}');continue
                # A string with a branch-selected filename is a parameter union.
                # Do not erase its option/keyword forms by turning it into a file port.
                base=re.sub(r'\[.*\]$','',norm(args[0]))
                if fn=='open' and (re.search(r"\b"+re.escape(base)+r"\[1\]\s*==\s*'@'",body) or re.search(r'\bstrdic\s*\(\s*'+re.escape(base)+r'\s*,',body)):
                    evidence.append(dict(parameter=role,source='spp',path=unit['path'],procedure=name,call=fn,access=access,representation='option-or-file'))
                    continue
                if fn=='open' and len(args)>2 and literal(args[2])!='TEXT_FILE':
                    filekind='binary'
                record(role,'inputs' if access=='READ_ONLY' else 'outputs',filekind,fn,access,unit['path'],name)
            elif fn in units:
                callee=units[fn]
                if callee is None:
                    issues.append(f'{fn}: ambiguous procedure definition');continue
                bound={formal:origin(arg) for formal,arg in zip(callee['args'],args) if origin(arg)}
                const={formal:literal(arg) for formal,arg in zip(callee['args'],args) if not origin(arg)}
                walk(fn,bound,const,(*stack,name))
            elif fn not in readers:
                roles={origin(arg) for arg in args}-{None}
                if roles:
                    issues.append(f'{", ".join(sorted(roles))}: unresolved call {fn} in {name}')

        # Read the task's actual list-length checks, including the boolean branch.
        for match in re.finditer(r'\bif\s*\(\s*(\w+)\s*\)\s*\{',body):
            flag=bools.get(match[1])
            end=closing_brace(body,match.end()-1)
            if not flag or end is None:continue
            otherwise=re.match(r'\s*else\s*\{',body[end+1:])
            if not otherwise:continue
            stop=closing_brace(body,end+otherwise.end())
            if stop is None:continue
            yes,no=body[match.end():end],body[end+otherwise.end()+1:stop]
            for variable,role in list_vars.items():
                length=r'imtlen\s*\(\s*'+re.escape(variable)+r'\s*\)'
                per_input=any(re.search(length+r'\s*!=\s*'+re.escape(count)+r'\b',yes) for count in counts)
                single=re.search(length+r'\s*(?:!=|>)\s*1\b',no)
                if per_input and single:
                    cardinality[role]=flag
                    evidence.append(dict(parameter=role,source='spp',path=unit['path'],procedure=name,call='imtlen',cardinalityParameter=flag))

    if entry:
        walk(entry, {}, {})
    unresolved=lists-set(ports)
    for role in sorted(unresolved):issues.append(f'{role}: image/list parameter has no resolved file access')
    profile=dict(inputs=[],outputs=[],fixed={})
    for role,p in pars.items():
        if role not in ports:continue
        direction,kind=ports[role]
        slot=dict(name=role,kind=kind)
        if direction=='inputs':
            slot.update(multiple=role in lists,required=p.get('required',False))
        else:
            optional='h' in p.get('mode','') and p.get('default')==''
            mode='single' if role in cardinality else 'each' if role in lists else 'single'
            slot.update(mode=mode,optional=optional,default='' if optional else role+('_' if mode=='each' else file_extension(kind)))
            if role in cardinality:slot['eachWhen']=cardinality[role]
        profile[direction].append(slot)
    source_files={path:hashes[path] for path in sorted(used_files) if path in hashes}
    issues=list(dict.fromkeys(issues))
    return dict(analysisVersion=ANALYSIS_VERSION,profile=profile,evidence=evidence,issues=issues,
                hints=hints,parameterControls=sorted(controls),parameterConstraints=constraints,complete=bool(ports) and not issues,accessedParameters=sorted(accessed),
                sourceFiles=source_files,sourceHash=hashlib.sha256(json.dumps(source_files,sort_keys=True).encode()).hexdigest())
