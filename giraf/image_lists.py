"""Image-list assets shared by GUI selection, task validation and workflows."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shlex
import tempfile

from .task_expressions import resolve_expression, split_image


def accepts_asset(kind, asset):
    return kind == asset or asset == 'image-list' and kind in ('image', 'text')


def check_input_lists(manifest):
    for source in manifest.get('inputLists', []):
        path = Path(source['path'])
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != source['sha256']:
            raise ValueError(f'{path.name}: 검증 이후 목록 파일이 변경되었습니다. 다시 실행해 주세요.')


def expand_image_selection(slot, ids, resolve, directory):
    rows, sources = [], {}
    def templates(path, stack=()):
        path = path.expanduser().resolve()
        if path in stack:
            raise ValueError(f'{path.name}: 목록 파일의 순환 참조가 있습니다.')
        if len(stack) >= 32:
            raise ValueError(f'{path.name}: 목록 중첩이 너무 깊습니다.')
        if not path.is_file():
            raise ValueError(f'{path}: 목록 파일이 없습니다.')
        if path.stat().st_size > 2_000_000:
            raise ValueError(f'{path.name}: 목록 파일이 너무 큽니다.')
        content = path.read_bytes()
        sources[str(path)] = dict(path=str(path), sha256=hashlib.sha256(content).hexdigest())
        try:
            lines = content.decode('utf-8-sig').splitlines()
        except UnicodeDecodeError:
            raise ValueError(f'{path.name}: UTF-8 텍스트 목록이 필요합니다.') from None
        result = []
        for number, line in enumerate(lines, 1):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            # Quotes allow spaces in a filename; a list entry has one template.
            try:
                fields = shlex.split(line, comments=True)
            except ValueError as exc:
                raise ValueError(f'{path.name}:{number}: {exc}') from None
            if not fields:
                continue
            if len(fields) != 1:
                raise ValueError(f'{path.name}:{number}: 한 줄에 영상 경로 하나를 입력해 주세요. 공백이 있는 경로는 따옴표로 감싸 주세요.')
            value = fields[0]
            if value.startswith('@'):
                nested = Path(value[1:])
                result.extend(templates(nested if nested.is_absolute() else path.parent / nested, (*stack, path)))
            else:
                raw, section = split_image(value)
                image = Path(raw).expanduser()
                image = image if image.is_absolute() else path.parent / image
                result.append(str(image) + section)
            if len(result) > 50000:
                raise ValueError(f'{path.name}: 목록 항목이 너무 많습니다.')
        return result

    for id in ids:
        row = deepcopy(resolve(id))
        if slot['kind'] != 'image' or row.get('asset', 'image') != 'image-list':
            rows.append(row)
            continue
        path = Path(row['path'])
        if not path.is_absolute():
            path = Path(directory) / path
        entries = templates(path)
        if not entries:
            raise ValueError(f'{path.name}: 영상 목록이 비어 있습니다.')
        # IRAF performs template expansion; the application only resolves each
        # list's relative paths and preserves ordering across nested lists.
        with tempfile.TemporaryDirectory(prefix='giraf-image-list-') as tmp:
            listing = Path(tmp) / 'images.list'
            listing.write_text('\n'.join(json.dumps(v, ensure_ascii=False) if any(c.isspace() for c in v) else v for v in entries) + '\n')
            try:
                expanded = resolve_expression('@' + str(listing), path.parent)
            except (ValueError, OSError) as exc:
                raise ValueError(f'{path.name}: {exc}') from None
        for item in expanded:
            if item.get('error'):
                raise ValueError(f'{path.name}: {item["name"]}: {item["error"]}')
        rows.extend(expanded)
    if not slot.get('multiple', True) and len(rows) > 1:
        raise ValueError(f'{slot.get("name", "input")}: 목록을 펼친 뒤 영상 한 개가 필요하지만 {len(rows)}개입니다.')
    return rows, list(sources.values())


def image_list_spec():
    return dict(name='workflow.image_list', taskName='image_list', title='image_list',
                package='workflow', description='Create an image list', adapter='generic', executor='image-list',
                inputs=[dict(name='input', label='Input images', kind='image', multiple=True, required=True)],
                outputs=[dict(name='output', label='Output image list', kind='image-list', mode='single', default='images.list')],
                output=None, kind='image-list', parameters=[], allParameters=[], parameterSets=[],
                fixed={}, schemaFiles={}, schemaFingerprint='image-list-v1', runnable=True)


def execute_image_list(runner):
    from .jobs import atomic_json
    from .task_session import Cancelled
    check_input_lists(runner.m)
    rows = {r['id']: r for r in runner.m['rows']}
    entries = []
    for id in runner.m['inputs']['input']:
        if (runner.job / 'cancel').exists():
            raise Cancelled('사용자가 중단했습니다.')
        row = rows[id]
        path = Path(row['path']).resolve()
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:
            raise ValueError(f'{path.name}: 검증 이후 입력 파일이 변경되었습니다.')
        value = str(path) + row.get('section', '')
        entries.append(json.dumps(value, ensure_ascii=False) if any(c.isspace() for c in value) else value)
    folder = runner.job / 'output'
    folder.mkdir(exist_ok=True)
    path = folder / 'images.list'
    path.write_text('\n'.join(entries) + '\n')
    atomic_json(runner.job / 'products.json', [dict(file='output/images.list', label=runner.m['outputs']['output'],
                asset='image-list', role='output', sha256=hashlib.sha256(path.read_bytes()).hexdigest())])
    atomic_json(runner.job / 'sources.json', list(rows.values()))
    (runner.job / 'task.log').write_text(f'Created image list with {len(entries)} entries.\n')
    runner.state('image_list 완료', 1, 'completed')
