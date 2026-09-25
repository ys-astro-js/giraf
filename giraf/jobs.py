"""Each IRAF session runs in its own process and directory."""
from datetime import datetime
from pathlib import Path
import json
import os
import subprocess
import sys
import uuid

from .model import Settings, selected, validate

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / 'runs'


def atomic_json(path, value):
    path = Path(path)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False))
    tmp.replace(path)


def start(rows, settings: Settings, operation='reduction', name='', workspace_folder=''):
    if operation not in ('reduction', 'combine'):
        raise ValueError('지원하지 않는 작업입니다.')
    from .combine import validate_combination
    from .products import product_name
    if operation == 'combine':
        name = product_name(name or 'Combined.fits', 'image')
    errors, warnings = (validate_combination if operation == 'combine' else validate)(rows, settings)
    if errors:
        raise ValueError('\n'.join(errors))
    job = RUNS / (datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6])
    job.mkdir(parents=True)
    atomic_json(job / 'manifest.json', dict(rows=[r for r in rows if r.get('use')] if operation == 'combine' else selected(rows), settings=settings.to_dict(), warnings=warnings, operation=operation, name=name, workspace_folder=workspace_folder))
    atomic_json(job / 'status.json', dict(state='queued', message='IRAF 세션 준비 중', progress=0))
    env = os.environ.copy()
    env['PYRAF_NO_DISPLAY'] = '1'
    env['PYTHONUNBUFFERED'] = '1'
    env['PYTHONPATH'] = str(ROOT) + os.pathsep + env.get('PYTHONPATH', '')
    try:
        with (job / 'worker.log').open('w') as log:
            process = subprocess.Popen([sys.executable, '-m', 'giraf.worker', str(job)], cwd=job,
                                       env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        atomic_json(job / 'process.json', {'pid': process.pid})
    except Exception as exc:
        atomic_json(job / 'status.json', dict(state='failed', message=str(exc), progress=0))
        raise
    return job


def status(job):
    p = Path(job) / 'status.json'
    data = json.loads(p.read_text()) if p.exists() else dict(state='unknown', message='상태 없음', progress=0)
    if data['state'] in ('running', 'queued','waiting'):
        proc = Path(job) / 'process.json'
        if proc.exists():
            try:
                os.kill(json.loads(proc.read_text())['pid'], 0)
            except ProcessLookupError:
                data.update(state='failed', message='작업 프로세스가 종료되었습니다. worker.log를 확인해 주세요.')
    return data
