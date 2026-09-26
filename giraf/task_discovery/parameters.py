"""Resolve package parameter sets and inherited defaults without executing IRAF."""
import re
from ..task_capabilities import read_parameters
from .packages import IDENT, DECLARATION, file_hash
from pathlib import Path


def read_task_parameters(path, folder, pkg, packages, all_pars, files):
    issues, sets, seen = [], [], set()
    parameters = read_parameters(path)
    package_file = folder / (pkg['leaf'] + '.par')
    if package_file.exists():
        files[str(package_file.resolve())] = file_hash(package_file)
        sets.append(dict(name='$package', task=pkg['leaf'], parameters=read_parameters(package_file)))

    def psets(pars, base, chain=()):
        for p in pars:
            if p['type'] != 'pset':
                continue
            ref = str(p['default'] or p['name'])
            if not re.fullmatch(IDENT, ref):
                issues.append(f'{p["name"]}: pset 참조를 해석할 수 없습니다.')
                continue
            if ref in chain:
                issues.append(f'{ref}: 순환 pset 참조입니다.')
                continue
            if ref in seen:
                continue
            seen.add(ref)
            source = base / (ref + '.par')
            if not source.exists():
                source = folder / (ref + '.par')
            if not source.exists():
                nearby = [p for p in all_pars.get(ref, []) if folder in p.parents]
                if not nearby:
                    nearby = all_pars.get(ref, [])
                if len(nearby) == 1:
                    source = nearby[0]
            if not source.exists():
                for package in packages.values():
                    for declared, target in DECLARATION.findall(package['source']):
                        if ref in re.split(r'[,\s]+', declared.strip()) and target.endswith('.par'):
                            stem = Path(target.split('$')[-1]).stem
                            candidates = all_pars.get(stem, [])
                            if len(candidates) == 1:
                                source = candidates[0]
            if not source.exists():
                issues.append(f'{ref}: pset 정의를 찾지 못했습니다.')
                continue
            nested = read_parameters(source)
            files[str(source.resolve())] = file_hash(source)
            sets.append(dict(name=ref, task=pkg['leaf'] + '.' + ref, parameters=nested))
            psets(nested, source.parent, (*chain, ref))
    psets(parameters, path.parent)
    for group in list(sets):
        psets(group['parameters'], folder)
    # Resolve inherited defaults using the owning package/pset, not CCD settings.
    lookup = {s['name']: {p['name']: p['default'] for p in s['parameters']} for s in sets}
    def inherited(value, visited=()):
        if not isinstance(value, str) or not value.startswith(')'):
            return value
        ref = value[1:]
        if ref in visited or '.' not in ref:
            raise ValueError(f'{ref}: 파라미터 간접 참조를 해석할 수 없습니다.')
        owner, key = ref.rsplit('.', 1)
        owner = '$package' if owner in ('_', pkg['leaf']) else owner
        if key not in lookup.get(owner, {}):
            raise ValueError(f'{ref}: 파라미터 간접 참조를 해석할 수 없습니다.')
        return inherited(lookup[owner][key], (*visited, ref))
    for par in parameters + [p for s in sets for p in s['parameters']]:
        try:
            par['default'] = inherited(par['default'])
        except ValueError:
            # IRAF resolves global/package references when the task
            # is loaded. Preserve these defaults and omit assignments.
            par['indirect'] = par['default']
    return parameters, sets, issues
