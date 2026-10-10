"""What interactive steps measured in workflow runs, kept per node and round.

A workflow run that reaches a task reading the cursor (a node schema `cursor`
component, giraf/node_schema.py) waits for the person to measure, round by
round. The completed run of each round is remembered here, with the hashes
of the files it measured. A later run whose round gets the same files uses
that run again instead of asking; clearing a round asks again.
"""
from datetime import datetime
import hashlib
import json
from pathlib import Path
import threading
import time
import uuid

from .jobs import atomic_json
from .products import IMAGE_SUFFIXES, KERNEL_KEYS, publish_product


def fingerprint(row):
    """What a file holds. A FITS image is its pixels and header cards, without
    the keys IRAF's image kernel rewrites on every write (an upstream task run
    again gives the same image with a new DATE); other files are their bytes."""
    path = Path(row.get('path', ''))
    if path.suffix.lower() in IMAGE_SUFFIXES and path.is_file():
        try:
            from astropy.io import fits
            digest = hashlib.sha256()
            with fits.open(path, memmap=False) as hdus:
                for hdu in hdus:
                    for card in hdu.header.cards:
                        if card.keyword not in KERNEL_KEYS:
                            digest.update(f'{card.keyword}={card.value!r}\n'.encode())
                    if hdu.data is not None:
                        digest.update(hdu.data.tobytes())
            return digest.hexdigest()
        except (OSError, ValueError, TypeError):
            pass
    return row.get('sha256')


def input_hashes(manifest):
    """The files a run read, by role, as fingerprints in their order."""
    rows = {r['id']: r for r in manifest.get('rows', [])}
    return {role: [fingerprint(rows[id]) if id in rows else None for id in ids]
            for role, ids in sorted(manifest.get('inputs', {}).items()) if ids}


def cursor_count(job, manifest):
    """Marks the person made: accepted plots when the task asks about each
    star (graphics accept), otherwise image clicks."""
    cursor = manifest.get('cursor') or {}
    accept = ((cursor.get('graphics') or {}).get('accept') or {}).get('key')
    kind, key = ('gcur', accept) if accept else ('imcur', (cursor.get('image') or {}).get('click'))
    history = Path(job) / 'interaction-history.jsonl'
    count = 0
    for line in history.read_text().splitlines() if history.exists() else []:
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        fields = str(entry.get('response', '')).split()
        if entry.get('kind') == kind and len(fields) >= 4 and fields[3] == key:
            count += 1
    return count


def count_text(manifest, count):
    template = ((manifest.get('cursor') or {}).get('image') or {}).get('count')
    return template.replace('{n}', str(count)) if template else f'{count}개'


def measured_label(manifest):
    rows = {r['id']: r for r in manifest.get('rows', [])}
    row = rows.get(manifest.get('cursorImage') or '')
    return (row.get('label') or Path(row['path']).name) if row else ''


class Measurements:
    def __init__(self, path, runs, describe):
        self.path = Path(path)
        self.runs = Path(runs)
        self.describe = describe
        self.lock = threading.RLock()

    def _load(self):
        try:
            return json.loads(self.path.read_text())
        except (OSError, ValueError):
            return {}

    def _save(self, data):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        atomic_json(self.path, data)

    @staticmethod
    def _key(manifest):
        return manifest.get('instanceId'), (manifest.get('round') or {}).get('name', '')

    def list(self, instance):
        with self.lock:
            records = self._load().get(instance, {})
        return [dict(record, round=name) for name, record in records.items()
                if (self.runs / record['job'] / 'products.json').exists()]

    def clear(self, instance, rounds=None):
        with self.lock:
            data = self._load()
            kept = {name: r for name, r in data.get(instance, {}).items() if rounds is not None and name not in rounds}
            if kept:
                data[instance] = kept
            else:
                data.pop(instance, None)
            self._save(data)

    def remember(self, manifest, job_id):
        instance, name = self._key(manifest)
        if not instance:
            return
        job = self.runs / job_id
        record = dict(job=job_id, inputs=input_hashes(manifest), count=cursor_count(job, manifest),
                      label=measured_label(manifest), at=time.time())
        with self.lock:
            data = self._load()
            data.setdefault(instance, {})[name] = record
            self._save(data)

    def reuse(self, manifest):
        """A new completed run carrying the round's earlier measurement, or None."""
        instance, name = self._key(manifest)
        with self.lock:
            record = self._load().get(instance, {}).get(name)
        previous = self.runs / record['job'] if record else None
        if not record or record['inputs'] != input_hashes(manifest) or not (previous / 'products.json').exists():
            return None
        try:
            status = json.loads((previous / 'status.json').read_text())['state']
            old = json.loads((previous / 'manifest.json').read_text())
            products = json.loads((previous / 'products.json').read_text())
        except (OSError, ValueError, KeyError):
            return None
        if status != 'completed':
            return None
        job = self.runs / (datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6])
        job.mkdir(parents=True)
        # The measured files are the same content under this run's file ids.
        ids = {r['id']: n['id'] for r in old.get('rows', []) for n in manifest.get('rows', [])
               if r.get('label') == n.get('label') or r.get('sha256') == n.get('sha256')}
        title = ' '.join(filter(None, [manifest.get('nodeLabel') or manifest['definition'].get('taskName', ''), name]))
        when = datetime.fromtimestamp(record['at']).strftime('%m/%d %H:%M:%S')
        (job / 'task.log').write_text(f"{title} 지난 측정 사용\n{' '.join(filter(None, [record.get('label'), count_text(manifest, record['count']), when]))}\n")
        published = []
        for product in products:
            if product.get('role') == '$log':
                continue
            product = {k: ids.get(v, v) if k in ('source', 'sourceInput') else v for k, v in product.items() if k != 'sha256'}
            published.append(publish_product(job, dict(product, file=str(previous / product['file'])), len(published)))
        published.append(publish_product(job, dict(file='task.log', label=manifest['definition'].get('taskName', 'task') + '-results.txt', asset='text', role='$log'), len(published)))
        atomic_json(job / 'manifest.json', dict(manifest, workspace_folder=manifest.get('workingDirectory', ''), reused=dict(job=record['job'], at=record['at'], count=record['count'])))
        atomic_json(job / 'products.json', published)
        atomic_json(job / 'status.json', dict(state='completed', message=f'{title} 지난 측정 사용', progress=1))
        return self.describe(job)
