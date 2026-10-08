"""What the `pass-files` and `save-files` schema components do (giraf/node_schema.py).

`pass-files` hands its input files on through the output whose kind matches
each file; `save-files` copies what it receives into a folder on the user's
device. The nodes themselves are defined in giraf/schemas.
"""
import json
import os
from pathlib import Path
import shlex
import shutil

CONFLICTS = ('number', 'overwrite')


def checked_destination(value, directory):
    """An empty path is the project folder; a relative path lives inside it."""
    value = value if isinstance(value, dict) else {}
    path, conflict = value.get('path', ''), value.get('conflict', 'number')
    if not isinstance(path, str) or '\x00' in path or len(path) > 4096:
        raise ValueError('저장 위치를 다시 선택해 주세요.')
    if conflict not in CONFLICTS:
        raise ValueError('같은 이름이 있을 때의 처리를 선택해 주세요.')
    folder = Path(directory) / Path(path).expanduser()
    if not folder.is_dir():
        raise ValueError(f'{folder}: 저장 위치 폴더가 없습니다.')
    return dict(path=path, folder=str(folder.resolve()), conflict=conflict)


def numbered(folder, name, taken=()):
    """`m67.mag.1` becomes `m67_1.mag.1`: IRAF names carry several dotted parts."""
    dot = name.find('.', 1)
    stem, rest = (name, '') if dot < 0 else (name[:dot], name[dot:])
    number = 1
    while (folder / f'{stem}_{number}{rest}').exists() or folder / f'{stem}_{number}{rest}' in taken:
        number += 1
    return folder / f'{stem}_{number}{rest}'


def save_targets(manifest):
    """Destination of each input, in order; numbering also avoids this run's own names."""
    destination = manifest['destination']
    folder = Path(destination['folder'])
    rows = {r['id']: r for r in manifest['rows']}
    planned, taken = [], set()
    ids = [id for slot in manifest['definition']['inputs'] for id in manifest['inputs'].get(slot['name'], [])]
    for id in ids:
        row = rows[id]
        target = folder / Path(row.get('label') or row['path']).name
        if destination['conflict'] == 'number' and (target.exists() or target in taken):
            target = numbered(folder, target.name, taken)
        taken.add(target)
        planned.append((row, target))
    return planned


def passed(manifest):
    """(row, output slot) for each input file, in the order the inputs list them."""
    rows = {r['id']: r for r in manifest['rows']}
    result = []
    for slot in manifest['definition']['inputs']:
        outputs = {o['kind']: o for o in manifest['definition']['outputs'] if o['from'] == slot['name']}
        for id in manifest['inputs'].get(slot['name'], []):
            row = rows[id]
            output = outputs.get(row.get('asset', 'image'))
            if not output:
                raise ValueError(f'{row.get("label") or row["name"]}: 이 노드가 넘겨줄 수 없는 파일 종류입니다.')
            result.append((row, output))
    return result


def preview_nodes(manifest):
    if manifest['definition']['run'] == 'save-files':
        return [dict(inputs=[row.get('label') or Path(row['path']).name], output=str(target))
                for row, target in save_targets(manifest)]
    return [dict(role=output['name'], source=row['id'], inputs=[row.get('label', row['name'])],
                 output=row.get('label', row['name'])) for row, output in passed(manifest)]


def _absolute_list(path):
    """A copied list must still find its entries, which may be relative to it."""
    lines = []
    for line in Path(path).read_text(encoding='utf-8-sig').splitlines():
        fields = shlex.split(line, comments=True) if line.strip() and not line.strip().startswith('#') else []
        if len(fields) != 1:
            lines.append(line)
            continue
        value = fields[0]
        nested = value.startswith('@')
        entry = Path(value[1:] if nested else value).expanduser()
        if not entry.is_absolute():
            entry = Path(path).parent / entry
        value = ('@' if nested else '') + str(entry)
        lines.append(json.dumps(value, ensure_ascii=False) if any(c.isspace() for c in value) else value)
    return '\n'.join(lines) + '\n'


def _verified(runner, row):
    from .task_discovery import file_hash
    from .task_session import Cancelled
    if (runner.job / 'cancel').exists():
        raise Cancelled('사용자가 중단했습니다.')
    path = Path(row['path'])
    if not path.is_file() or file_hash(path) != row['sha256']:
        raise ValueError(f'{row.get("label") or path.name}: 검증 이후 입력 파일이 변경되었거나 없어졌습니다.')
    return path


def execute_pass_files(runner):
    from .jobs import atomic_json
    from .products import publish_product
    products = []
    staging = runner.job / 'output'
    staging.mkdir(exist_ok=True)
    for row, output in passed(runner.m):
        path = _verified(runner, row)
        source = path
        if output['kind'] == 'image-list':
            source = staging / f'{len(products):05d}.list'
            source.write_text(_absolute_list(path))
        products.append(publish_product(runner.job, dict(file=str(source), label=row.get('label') or path.name,
                                                          asset=output['kind'], role=output['name'], source=row['id']), len(products)))
    atomic_json(runner.job / 'sources.json', runner.m['rows'])
    (runner.job / 'task.log').write_text(f'{len(products)}개 파일을 전달했습니다.\n')
    name = runner.m['definition']['taskName']
    products.append(publish_product(runner.job, dict(file='task.log', label=f'{name}-results.txt', asset='text', role='$log'), len(products)))
    atomic_json(runner.job / 'products.json', products)
    runner.state(f'{name} 완료', 1, 'completed')


def execute_save_files(runner):
    from .jobs import atomic_json
    from .products import publish_product
    destination = runner.m['destination']
    folder = Path(destination['folder'])
    if not folder.is_dir():
        raise ValueError(f'{folder}: 저장 위치 폴더가 없습니다.')
    saved = []
    with (runner.job / 'task.log').open('w') as log:
        for row, target in save_targets(runner.m):
            path = _verified(runner, row)
            temporary = target.with_name(f'.{target.name}.giraf-{os.getpid()}')
            shutil.copy2(path, temporary)
            os.replace(temporary, target)
            saved.append(dict(source=row['id'], label=row.get('label') or path.name, path=str(target)))
            log.write(f'{row.get("label") or path.name} -> {target}\n')
    atomic_json(runner.job / 'saved.json', saved)
    atomic_json(runner.job / 'products.json', [publish_product(
        runner.job, dict(file='task.log', label=runner.m['definition']['taskName'] + '-results.txt', asset='text', role='$log'), 0)])
    runner.state(f'{len(saved)}개 파일 저장 완료', 1, 'completed')
