"""Track filename provenance and native file access within one SPP procedure."""
import re
from ..task_schema import calls
from .syntax import closing_brace

# Known non-file consumers do not imply an unknown file operation.
NON_FILE_READERS = {'imtlen','imtrew','imtclose','fntclsb','clpcls','pargstr','printf','eprintf',
           'fprintf','strmatch','streq','strdic','strlen','nowhite','fnextn','access',
           'imastr','imstats','erract','error','salloc','smark','sfree','malloc','mfree',
           'sscan','gargwrd','strlwr','ctor','imgstr','if','iferr','while','switch','return'}

def norm(value):
    return re.sub(r'\s+', '', value)


class ProcedureAnalysis:
    def __init__(self, analysis, name, unit, body, bindings, constants, stack):
        self.analysis = analysis
        self.name, self.unit, self.body, self.stack = name, unit, body, stack
        self.values, self.formats = dict(bindings), {}
        self.literals = dict(self.unit.get('constants', {}), **constants)
        self.bools, self.list_vars, self.counts = {}, {}, {}
        self.formatter = None


    def origin(self, value):
        value = norm(value)
        if value in self.values:
            return self.values[value]
        # Character substrings retain the filename's provenance.
        match = re.fullmatch(r'(\w+)\[\d+(?:\+\d+)?\]', value)
        return self.values.get(match[1]) if match else None


    def literal(self, value):
        if value.strip().startswith('"'):
            return value.strip()
        value = norm(value)
        return self.literals.get(value, value)


    def run(self):
        events = [(pos, 'call', (fn,args)) for pos,fn,args in calls(self.body)]
        for match in re.finditer(r'(?:^|[;\n])\s*(\w+)\s*=\s*(\w+)\s*(?=[;\n])', self.body):
            events.append((match.start(), 'assign', (match[1], match[2])))
        for pos, kind, item in sorted(events, key=lambda v:v[0]):
            if kind == 'assign':
                left,right=item
                if self.origin(right): self.values[left]=self.origin(right)
                if right in self.literals or right in ('YES','NO'): self.literals[left]=self.literal(right)
                continue
            fn,args=item
            match=re.search(r'(\w+)\s*=\s*$',self.body[:pos])
            dest=match[1] if match else None
            if (self.parameter_call(fn, args, dest)
                    or self.string_call(fn, args, dest)
                    or self.file_call(fn, args, dest)):
                continue
            if fn in self.analysis.units:
                callee=self.analysis.units[fn]
                if callee is None:
                    self.analysis.issues.append(f'{fn}: ambiguous procedure definition');continue
                bound={formal:self.origin(arg) for formal,arg in zip(callee['args'],args) if self.origin(arg)}
                const={formal:self.literal(arg) for formal,arg in zip(callee['args'],args) if not self.origin(arg)}
                self.analysis.walk(fn,bound,const,(*self.stack,self.name))
            elif fn not in NON_FILE_READERS:
                roles={self.origin(arg) for arg in args}-{None}
                if roles:
                    self.analysis.issues.append(f'{", ".join(sorted(roles))}: unresolved call {fn} in {self.name}')

        self.record_cardinality()

    def parameter_call(self, fn, args, dest):
        if fn == 'clgstr' and len(args)>1:
            role=self.literal(args[0]).strip('"')
            if role in self.analysis.pars:
                self.values[norm(args[1])]=role; self.analysis.accessed.add(role)
                target = norm(args[1])
                # Explicit dispatch through a dictionary or @ prefix makes
                # this a native setting with a file alternative.
                at_file = re.search(re.escape(target)+r"\[1\]\s*==\s*'@'", re.sub(r'\s+', '', self.body))
                dictionary = re.search(r'\bstrdic\s*\(\s*'+re.escape(target)+r'\s*,', re.sub(r'\s+', '', self.body))
                if at_file or dictionary:
                    self.analysis.controls.add(role)
                    self.analysis.evidence.append(dict(parameter=role, source='spp', path=self.unit['path'], procedure=self.name,
                                         representation='option-or-file', call='clgstr'))
        elif fn in ('clgetb','clgeti','clgetr','clgetc','clgwrd') and args:
            role=self.literal(args[0]).strip('"')
            if role in self.analysis.pars:
                self.analysis.accessed.add(role)
                self.analysis.controls.add(role)
                if fn=='clgetb' and dest: self.bools[dest]=role
                if fn=='clgwrd' and len(args)>=4:
                    dictionary=self.literal(args[3]).strip('"')
                    if dictionary.startswith('|') and dictionary.endswith('|'):
                        self.analysis.constraints[role]=dict(choices=[v for v in dictionary.split('|') if v], prefixes=[], closed=True,
                                               source='spp', path=self.unit['path'], procedure=self.name, call=fn)
        elif fn in ('imtopenp','clpopnu','clpopni','clpopns') and dest and args:
            role=self.literal(args[0]).strip('"')
            if role in self.analysis.pars:
                self.values[dest]=role; self.analysis.lists.add(role); self.list_vars[dest]=role; self.analysis.accessed.add(role)
        elif fn in ('imtopen','fntopnb') and dest and args and self.origin(args[0]):
            self.values[dest]=self.origin(args[0]); self.analysis.lists.add(self.origin(args[0])); self.list_vars[dest]=self.origin(args[0])
        elif fn in ('imtgetim','clgfil','fntgfnb','imtrgetim') and len(args)>1 and self.origin(args[0]):
            self.values[norm(args[2] if fn=='imtrgetim' else args[1])]=self.origin(args[0])
        elif fn=='imtlen' and dest and args and self.origin(args[0]):
            self.counts[dest]=self.origin(args[0])
        else:
            return False
        return True

    def string_call(self, fn, args, dest):
        if fn in ('strcpy','strcat') and len(args)>1:
            target=norm(args[1])
            if self.origin(args[0]): self.values[target]=self.origin(args[0])
            elif fn=='strcpy': self.values.pop(target,None)
            if fn=='strcat' and self.literal(args[0]).strip('"')=='.pl': self.formats[target]='mask'
        elif fn=='sprintf' and args:
            # Only literal filename templates have a known string-transfer
            # contract. Diagnostic sentences do not rename their arguments.
            template=self.literal(args[2]).strip('"') if len(args)>2 else ''
            self.formatter=norm(args[0]) if '%s' in template and not re.search(r'\s',template) else None
            if self.formatter: self.values.pop(self.formatter,None)
        elif fn in ('printf','fprintf','eprintf'):
            self.formatter=None
        elif fn=='strdic' and len(args)>=4 and self.origin(args[0]):
            role=self.origin(args[0])
            dictionary=self.literal(args[3]).strip('"')
            if dictionary.startswith('|') and dictionary.endswith('|'):
                target=re.escape(norm(args[0]))
                prefixes=sorted(set(re.findall(target+r"\[1\]==\s*'(.)'", re.sub(r'\s+', '', self.body))))
                self.analysis.constraints[role]=dict(choices=[v for v in dictionary.split('|') if v], prefixes=prefixes, closed=False,
                                       source='spp', path=self.unit['path'], procedure=self.name, call='strdic')
                self.analysis.controls.add(role)
        elif fn=='pargstr' and args and self.formatter and self.origin(args[0]):
            self.values[self.formatter]=self.origin(args[0])
        elif fn=='mktemp' and len(args)>1:
            self.values.pop(norm(args[1]),None)
        elif fn=='imstats' and len(args)>2:
            self.values.pop(norm(args[2]),None)
        elif fn=='aptmpimage' and len(args)>=4 and self.origin(args[1]):
            role=self.origin(args[1]); self.analysis.hints.append(dict(name=role,naming='prefix',kind='image',mode='each'))
            self.analysis.evidence.append(dict(parameter=role,source='spp',path=self.unit['path'],call=fn,direction='output',naming='prefix'))
        else:
            return False
        return True

    def file_call(self, fn, args, dest):
        if fn in ('immap','xt_immap','open') and len(args)>1 and self.origin(args[0]):
            role=self.origin(args[0]); access=self.literal(args[1]); filekind=self.formats.get(norm(args[0]),'text' if fn=='open' else 'image')
            if role in self.analysis.controls:
                return True
            if access not in ('READ_ONLY','NEW_COPY','NEW_IMAGE','NEW_FILE','APPEND','READ_WRITE'):
                self.analysis.issues.append(f'{role}: unresolved access mode {access} in {self.name}');return True
            if access in ('APPEND','READ_WRITE'):
                # Keep terminal/log settings as native parameters, not input ports.
                if self.analysis.pars[role].get('default') in ('STDOUT','STDERR'):
                    self.analysis.controls.add(role)
                    return True
                self.analysis.issues.append(f'{role}: in-place access in {self.name}');return True
            # A string with a branch-selected filename is a parameter union.
            # Do not erase its option/keyword forms by turning it into a file port.
            base=re.sub(r'\[.*\]$','',norm(args[0]))
            if fn=='open' and (re.search(r"\b"+re.escape(base)+r"\[1\]\s*==\s*'@'",self.body) or re.search(r'\bstrdic\s*\(\s*'+re.escape(base)+r'\s*,',self.body)):
                self.analysis.evidence.append(dict(parameter=role,source='spp',path=self.unit['path'],procedure=self.name,call=fn,access=access,representation='option-or-file'))
                return True
            if fn=='open' and len(args)>2 and self.literal(args[2])!='TEXT_FILE':
                filekind='binary'
            self.analysis.record(role,'inputs' if access=='READ_ONLY' else 'outputs',filekind,fn,access,self.unit['path'],self.name)
        else:
            return False
        return True

    def record_cardinality(self):
        # Read the task's actual list-length checks, including the boolean branch.
        for match in re.finditer(r'\bif\s*\(\s*(\w+)\s*\)\s*\{',self.body):
            flag=self.bools.get(match[1])
            end=closing_brace(self.body,match.end()-1)
            if not flag or end is None:continue
            otherwise=re.match(r'\s*else\s*\{',self.body[end+1:])
            if not otherwise:continue
            stop=closing_brace(self.body,end+otherwise.end())
            if stop is None:continue
            yes,no=self.body[match.end():end],self.body[end+otherwise.end()+1:stop]
            for variable,role in self.list_vars.items():
                length=r'imtlen\s*\(\s*'+re.escape(variable)+r'\s*\)'
                per_input=any(re.search(length+r'\s*!=\s*'+re.escape(count)+r'\b',yes) for count in self.counts)
                single=re.search(length+r'\s*(?:!=|>)\s*1\b',no)
                if per_input and single:
                    self.analysis.cardinality[role]=flag
                    self.analysis.evidence.append(dict(parameter=role,source='spp',path=self.unit['path'],procedure=self.name,call='imtlen',cardinalityParameter=flag))
