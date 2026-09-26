"""Bounded SPP data-flow analysis for IRAF file contracts.

Trace parameter values through local procedure arguments to file APIs. This is
not a full SPP compiler: unresolved file-bearing calls remain explicit issues,
and partial evidence is usable without claiming that the contract is complete.
"""
import hashlib
import re
from pathlib import Path

from .syntax import without_comments, procedures
from .analysis import ANALYSIS_VERSION, analyze as _analyze


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
