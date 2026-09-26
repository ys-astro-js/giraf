"""Read IRAF package declarations without evaluating CL code.

Discovery compiles parameters into forms and workflow ports. Optional source
evidence refines file roles; optional external descriptors override exceptions. No IRAF package is executed in the web server during discovery.
"""
import hashlib
import json
import os
from pathlib import Path
import re

IDENT = r'[A-Za-z_][A-Za-z0-9_]*'
PACKAGE = re.compile(r'^\s*package\s+(' + IDENT + r')\b', re.M)
DECLARATION = re.compile(r'^\s*task\s+([\w$.,\s]+?)\s*=\s*[\'\"]?([^\s\'\"\n]+)', re.M)


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def env_paths(name):
    return [Path(p).expanduser() for p in os.environ.get(name, '').split(os.pathsep) if p]


def scan_packages(roots, diagnostics):
    packages = {}
    all_pars = {}
    for folder, external in roots:
        if not folder.is_dir():
            diagnostics.append(f'패키지 경로가 없습니다: {folder}')
            continue
        for path in sorted(folder.rglob('*.par')):
            all_pars.setdefault(path.stem, []).append(path)
        for path in sorted(folder.rglob('*.cl')):
            try:
                source = '\n'.join(line.split('#', 1)[0] for line in path.read_text(errors='replace').splitlines())
                match = PACKAGE.search(source)
                if not match or match[1] != path.stem:
                    continue
                packages[path.parent] = dict(leaf=match[1], path=path.resolve(), folder=folder.resolve(), external=external, source=source)
            except OSError as exc:
                diagnostics.append(str(exc))
    for folder, pkg in packages.items():
        ancestors = [p for parent, p in packages.items() if parent == folder or parent in folder.parents]
        ancestors.sort(key=lambda p: len(p['path'].parts))
        pkg['name'] = '.'.join(p['leaf'] for p in ancestors)
        pkg['loadPackages'] = [p['leaf'] for p in ancestors]
        pkg['bootstrap'] = dict(name=ancestors[0]['leaf'], path=str(ancestors[0]['path'])) if pkg['external'] else None

    return packages, all_pars


def read_overrides(descriptors, diagnostics):
    overrides = {}
    for path in map(Path, descriptors):
        try:
            data = json.loads(path.read_text())
            if data.get('version') != 1 or not isinstance(data.get('tasks'), dict):
                raise ValueError('version=1 및 tasks 객체가 필요합니다.')
            for name, profile in data['tasks'].items():
                overrides[name] = profile
        except (OSError, ValueError) as exc:
            diagnostics.append(f'{path}: {exc}')

    return overrides
