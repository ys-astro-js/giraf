"""Stage validated inputs and bind native IRAF file arguments inside a job."""
from pathlib import Path
import shutil

from ..image_lists import check_input_lists
from ..jobs import atomic_json
from ..products import IMAGE_SUFFIXES
from ..staging import staged_names
from ..task_discovery import file_hash
from ..task_schema import file_extension


def stage_inputs(job, manifest):
    check_input_lists(manifest)
    for path, expected in manifest['definition']['schemaFiles'].items():
        if not Path(path).is_file() or file_hash(path) != expected:
            raise ValueError('IRAF 패키지 정의가 변경되었습니다. 목록을 새로고침한 뒤 다시 실행해 주세요.')
    for folder in ('input', 'output', 'lists', 'uparm'):
        (job / folder).mkdir(exist_ok=True)
    aliases = {}
    sources = []
    wanted = []
    for index, row in enumerate(manifest['rows']):
        path = Path(row['path'])
        label = row.get('label') or path.name
        if not path.is_file():
            raise ValueError(f'{label}: 입력 파일이 없습니다.')
        if file_hash(path) != row['sha256']:
            raise ValueError(f'{label}: 입력 파일이 검증 이후 변경되었습니다.')
        name, suffix = path.name, path.suffix
        if row.get('asset') == 'image' and suffix.lower() not in IMAGE_SUFFIXES:
            # IRAF cannot open a FITS image named e.g. `M67b.psf.1`
            name, suffix = name + '.fits', '.fits'
        wanted.append((str(path.resolve()), name, f's{index:05d}' + suffix))
    names = staged_names(job / 'input', wanted)
    for row, name in zip(manifest['rows'], names):
        alias = 'input/' + name
        if not (job / alias).exists():
            shutil.copy2(row['path'], job / alias)
        aliases[row['id']] = alias + row.get('section', '')
        sources.append(dict(id=row['id'], original=row['path'], alias=alias, sha256=row['sha256']))
    atomic_json(job / 'sources.json', sources)
    return aliases


def prepare_parameters(job, manifest, aliases):
    spec = manifest['definition']
    params = dict(manifest['parameters'], **spec.get('fixed', {}))
    for slot in spec['inputs']:
        name = slot['name']
        ids = manifest['inputs'][name]
        if not ids and slot.get('scalar'):
            continue
        paths = [aliases[id] for id in ids]
        if len(paths) < 2:
            params[name] = paths[0] if paths else ''
        else:
            listing = 'lists/' + name + '.list'
            (job / listing).write_text('\n'.join(paths) + '\n')
            params[name] = '@' + listing
    for field, extension in (('cursorCommands', 'cursor'), ('textInputs', 'txt')):
        for name, records in manifest.get(field, {}).items():
            if records.strip():
                path = f'lists/{name}.{extension}'
                (job / path).write_text(records.rstrip() + '\n')
                params[name] = path
    return params


def plan_outputs(manifest, previews):
    spec = manifest['definition']
    slots = {slot['name']: slot for slot in spec['outputs']}
    rows = {r['id']: r for r in manifest['rows']}
    main = manifest['inputs'].get(spec['inputs'][0]['name'], []) if spec['inputs'] else []
    expected = []
    for index, preview in enumerate(p for p in previews if 'role' in p):
        slot = slots[preview['role']]
        product = dict(file=f'output/o{index:05d}{file_extension(slot["kind"])}',
                       label=preview['output'], asset=slot['kind'], role=preview['role'])
        if 'source' in preview:
            product.update(source=preview['source'], index=preview['index'])
        elif len(main) == 1 and main[0] in rows and rows[main[0]].get('asset', 'image') == 'image':
            # A single output of a run over one image (daoedit's table) comes from
            # that image. `source` stays for per-input outputs, which name outcomes.
            product['sourceInput'] = main[0]
        expected.append(product)
    return expected


def bind_outputs(job, manifest, params, aliases, expected):
    spec = manifest['definition']
    each = any(s['mode'] == 'each' and manifest['outputs'].get(s['name']) for s in spec['outputs'])
    main = manifest['inputs'].get(spec['inputs'][0]['name'], []) if spec['inputs'] else []
    if each and not main:
        raise ValueError('입력마다 출력을 만드는 작업에는 입력 파일이 필요합니다.')
    # Cardinality describes products, not invocations. Pass lists once so IRAF
    # retains shared trims, appended plots, and broadcast coordinate semantics.
    call = dict(params)
    for slot in spec['outputs']:
        name = slot['name']
        if slot.get('optional') and not manifest['outputs'].get(name):
            call[name] = ''
        products = [p for p in expected if p['role'] == name]
        if slot.get('mode') == 'pass':
            # IRAF edits the staged copy itself; that copy is the result.
            for product in products:
                product['file'] = aliases[product['source']].split('[')[0]
            continue
        if name == '$stdout' or not products:
            continue
        if slot.get('naming') == 'prefix':
            prefix = 'output/' + name + '_'
            call[name] = prefix
            for product in products:
                product['file'] = prefix + Path(aliases[product['source']].split('[')[0]).name
        elif len(products) == 1:
            call[name] = products[0]['file']
        else:
            listing = 'lists/' + name + '-outputs.list'
            (job / listing).write_text('\n'.join(p['file'] for p in products) + '\n')
            call[name] = '@' + listing
    return call
