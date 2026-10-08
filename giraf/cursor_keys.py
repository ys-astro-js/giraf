"""Read IRAF's own cursor key help (.key files) for interactive tasks.

IRAF pages these files when the user types `?` at a cursor prompt. The same
text lets GIRAF offer the keys as buttons without per-task code. A file whose
section titles mention graphics describes the graphics cursor (gcur); when a
task has such a file, its other files describe the image cursor (imcur).
"""
from pathlib import Path
import re

KEY = re.compile(r'^(\S)(?:\s*\t|\s{2,})\s*(\S.*)$')
COLON = re.compile(r'^(:\S+(?:[ \t]+\[[^\]]*\])*)(?:\s*\t|\s{2,})\s*(\S.*)$')


def parse_key_file(path):
    keys, colon, titles = [], [], []
    for raw in Path(path).read_text(errors='replace').splitlines():
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith('#') or line.startswith('.'):
            continue
        if match := COLON.match(line):
            colon.append(dict(command=' '.join(match[1].split()), description=match[2].strip()))
        elif match := KEY.match(line):
            keys.append(dict(key=match[1], description=match[2].strip()))
        elif raw[:1].isspace() and not keys and not colon:
            titles.append(line.strip())
    cursor = 'graphics' if any('graphics' in t.lower() for t in titles) else 'image' if any('image' in t.lower() for t in titles) else None
    return dict(file=Path(path).name, cursor=cursor, keys=keys, colon=colon)


def key_files(par_path, task_name):
    par = Path(par_path)
    found = sorted((par.parent / task_name).glob('*.key'))
    for parent in par.parents:
        candidate = parent / 'lib' / 'scr' / f'{task_name}.key'
        if candidate.is_file():
            found.append(candidate)
    return list(dict.fromkeys(found))


def cursor_keys(spec):
    par = next((p for p in spec.get('schemaFiles', {}) if p.endswith('/' + spec['taskName'] + '.par')), None)
    if not par:
        return []
    groups = [g for g in map(parse_key_file, key_files(par, spec['taskName'])) if g['keys'] or g['colon']]
    labelled = {g['cursor'] for g in groups} - {None}
    merged = {}
    for group in groups:
        kinds = [group['cursor']] if group['cursor'] else ['image'] if labelled == {'graphics'} else ['image', 'graphics']
        for kind in kinds:
            target = merged.setdefault(kind, dict(cursor=kind, files=[], keys={}, colon={}))
            target['files'].append(group['file'])
            for k in group['keys']: target['keys'].setdefault(k['key'], k)
            for c in group['colon']: target['colon'].setdefault(c['command'], c)
    return [dict(g, keys=list(g['keys'].values()), colon=list(g['colon'].values())) for g in merged.values()]
