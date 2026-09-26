"""Read IRAF package declarations without evaluating CL code.

Discovery compiles parameters into forms and workflow ports. Optional source
evidence refines file roles; optional external descriptors override exceptions. No IRAF package is executed in the web server during discovery.
"""
import json
from pathlib import Path
import re

from ..task_capabilities import installed_root
from .packages import IDENT, DECLARATION, file_hash, env_paths, scan_packages, read_overrides
from .definition import task_definition, apply_profile

def discover(root=None, extra_roots=(), descriptors=()):
    root = Path(root) if root else installed_root()
    diagnostics = []
    roots = [(root / name, False) for name in ('pkg', 'noao') if root and (root / name).is_dir()]
    if root and (root / 'extern').is_dir():
        roots += [(p, True) for p in sorted((root / 'extern').iterdir()) if p.is_dir()]
    roots += [(Path(p).resolve(), True) for p in extra_roots]
    packages, all_pars = scan_packages(roots, diagnostics)
    overrides = read_overrides(descriptors, diagnostics)

    generated_path = Path(__file__).resolve().parent.parent / 'task_schemas.json'
    generated = json.loads(generated_path.read_text()).get('tasks', {}) if generated_path.exists() else {}
    tasks = {}
    task_descriptions = {}
    for folder, pkg in sorted(packages.items(), key=lambda item: item[1]['name']):
        menu = folder / (pkg['leaf'] + '.men')
        descriptions = dict(re.findall(r'^\s*(\w+)\s+-\s+(.+)$', menu.read_text(), re.M)) if menu.is_file() else {}
        task_descriptions.update({pkg['name'] + '.' + key: value for key, value in descriptions.items()})
        declarations = {}
        for names, target in DECLARATION.findall(pkg['source']):
            for name in re.split(r'[,\s]+', names.strip()):
                if re.fullmatch(IDENT, name):
                    declarations[name] = target
        for name, target in declarations.items():
            if target.endswith('.par') or name.startswith('_'):
                continue
            candidates = all_pars.get(name, [])
            path = folder / (name + '.par')
            if not path.exists():
                path = next((p for p in candidates if folder in p.parents), None)
            if path is None:
                # A declaration with no .par is not a fabricated runnable form.
                continue
            identity = pkg['name'] + '.' + name
            try:
                tasks[identity] = task_definition(name, path, pkg, packages, all_pars, generated, overrides, descriptions.get(name, ''))
            except (OSError, ValueError) as exc:
                diagnostics.append(f'{identity}: {exc}')
    return dict(tasks=tasks, diagnostics=diagnostics, descriptions=task_descriptions)
