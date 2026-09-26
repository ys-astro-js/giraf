"""Derive product names from a frozen manifest without running IRAF."""
from pathlib import Path

from ..products import product_name
from ..task_schema import file_extension


def preview_generic(manifest):
    spec = manifest['definition']; rows = {r['id']: r for r in manifest['rows']}
    main = manifest['inputs'].get(spec['inputs'][0]['name'], []) if spec['inputs'] else []
    result = []
    for slot in spec['outputs']:
        value = manifest['outputs'][slot['name']]
        if slot.get('optional') and not value:
            continue
        if slot['mode'] == 'each':
            for index, id in enumerate(main):
                prefix = value
                source = Path(rows[id].get('label') or rows[id]['name'])
                ext = (source.suffix or '.fits') if slot['kind'] == 'image' else file_extension(slot['kind'])
                label = product_name(f'{prefix}{source.stem}{ext}', slot['kind'])
                result.append(dict(role=slot['name'], source=id, index=index, inputs=[rows[id].get('label', rows[id]['name'])], output=label))
        else:
            result.append(dict(role=slot['name'], inputs=[r.get('label', r['name']) for r in rows.values()], output=product_name(value, slot['kind'])))
    return result or [dict(inputs=[r.get('label', r['name']) for r in rows.values()], output=spec['taskName']+'-results.txt')]

