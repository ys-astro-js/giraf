"""Accumulate cross-procedure source evidence and compile the I/O profile."""
import hashlib
import json
from ..task_schema import file_extension
from .syntax import constant_branches
from .procedure import ProcedureAnalysis


ANALYSIS_VERSION = 2


class SourceAnalysis:
    def __init__(self, parameters, units, hashes):
        self.units, self.hashes = units, hashes
        self.pars = {p['name']: p for p in parameters}
        self.ports, self.lists, self.evidence, self.issues, self.hints = {}, set(), [], [], []
        self.used_files, self.accessed, self.visited, self.controls = set(), set(), set(), set()
        self.cardinality = {}
        self.constraints = {}

    def record(self, role, direction, kind, fn, access, path, procedure):
        prior = self.ports.get(role)
        if prior and prior[0] != direction:
            self.issues.append(f'{role}: conflicting file directions in {procedure}')
            return
        if prior and prior[1] == 'mask' and kind == 'image':
            kind = 'mask'
        elif prior and prior[1] != kind and {prior[1],kind} != {'image','mask'}:
            self.issues.append(f'{role}: conflicting file formats in {procedure}')
            return
        self.ports[role] = (direction, kind)
        self.evidence.append(dict(parameter=role, source='spp', path=path, procedure=procedure,
                             call=fn, access=access, direction=direction[:-1]))

    def walk(self, name, bindings, constants, stack=()):
        unit = self.units.get(name)
        if unit is None:
            return
        key = (name, tuple(sorted(bindings.items())), tuple(sorted(constants.items())))
        if key in self.visited:
            return
        if name in stack:
            self.issues.append(f'{name}: recursive procedure cannot be fully analyzed')
            return
        self.visited.add(key)
        self.used_files.add(unit['path'])
        self.used_files.update(unit.get('dependencies', []))
        body = constant_branches(unit['body'], constants)
        ProcedureAnalysis(self, name, unit, body, bindings, constants, stack).run()

    def result(self):
        unresolved=self.lists-set(self.ports)
        for role in sorted(unresolved):self.issues.append(f'{role}: image/list parameter has no resolved file access')
        profile=dict(inputs=[],outputs=[],fixed={})
        for role,p in self.pars.items():
            if role not in self.ports:continue
            direction,kind=self.ports[role]
            slot=dict(name=role,kind=kind)
            if direction=='inputs':
                slot.update(multiple=role in self.lists,required=p.get('required',False))
            else:
                optional='h' in p.get('mode','') and p.get('default')==''
                mode='single' if role in self.cardinality else 'each' if role in self.lists else 'single'
                slot.update(mode=mode,optional=optional,default='' if optional else role+('_' if mode=='each' else file_extension(kind)))
                if role in self.cardinality:slot['eachWhen']=self.cardinality[role]
            profile[direction].append(slot)
        source_files={path:self.hashes[path] for path in sorted(self.used_files) if path in self.hashes}
        self.issues=list(dict.fromkeys(self.issues))
        return dict(analysisVersion=ANALYSIS_VERSION,profile=profile,evidence=self.evidence,issues=self.issues,
                    hints=self.hints,parameterControls=sorted(self.controls),parameterConstraints=self.constraints,complete=bool(self.ports) and not self.issues,accessedParameters=sorted(self.accessed),
                    sourceFiles=source_files,sourceHash=hashlib.sha256(json.dumps(source_files,sort_keys=True).encode()).hexdigest())


def analyze(parameters, units, entry, hashes):
    analysis = SourceAnalysis(parameters, units, hashes)
    if entry:
        analysis.walk(entry, {}, {})
    return analysis.result()
