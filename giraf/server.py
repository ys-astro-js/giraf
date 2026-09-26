"""Local workbench API. Files are referenced by registered IDs, never shell text."""
from __future__ import annotations
from copy import deepcopy
from functools import lru_cache, partial
from pathlib import Path
import hashlib
import json
import threading
import subprocess
import sys

from astropy.io import fits
from send2trash import send2trash
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.exceptions import HTTPException
from pydantic import ValidationError
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Route, Mount
from starlette.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.concurrency import run_in_threadpool

from .api_contract import request_payload, LocalOriginMiddleware, validation_error, api_error, http_error
from .workflow_preferences import document_action, initial_preferences
from .image_rendering import image_info, image_png, image_pixel
from .workflow_documents import WorkflowDocuments
from .jobs import ROOT, RUNS, start, status, atomic_json
from .model import Settings, inspect_file, scan, validate
from .combine import validate_combination
from .task_catalog import catalog
from .task_jobs import validate_task, preview_task, start_task, authorize_file_plan
from .workflow_diagnostics import workflow_diagnostics
from .request_schema import WorkflowRequest

STATE = ROOT / '.workspace.json'
registry: dict[str, dict] = {}
lock = threading.Lock()
workspace = json.loads(STATE.read_text()) if STATE.exists() else {'folder': str(ROOT), 'sets': [], 'overrides': {}}


def save():
    atomic_json(STATE, workspace)


@lru_cache(maxsize=512)
def _inventory_metadata(path, version):
    return inspect_file(path)


def inventory_metadata(path):
    """Reuse unchanged FITS headers without sharing mutable registry metadata."""
    path = Path(path).resolve()
    try:
        stat = path.stat()
    except OSError:
        # Missing/unreadable files retain inspect_file's actionable error row.
        return inspect_file(path)
    version = (stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size, stat.st_dev, stat.st_ino)
    return deepcopy(_inventory_metadata(path, version))


def register(path, label=None, job=None, asset=None, *, inspected=None):
    path = Path(path).resolve()
    id = hashlib.sha256(str(path).encode()).hexdigest()[:20]
    asset = asset or ('image-list' if path.suffix.lower()=='.list' else 'image' if path.suffix.lower() in ('.fits','.fit','.fts') else 'mask' if path.suffix.lower()=='.pl' else 'metacode' if path.suffix.lower()=='.gki' else 'binary' if path.suffix.lower()=='.bin' else 'text')
    if asset == 'image':
        r = deepcopy(inspected) if inspected is not None else inventory_metadata(path)
    else:
        r = dict(path=str(path), name=path.name, kind='exclude', detected_kind='exclude',
                 filter='', exposure=0, shape='', history={}, error='', note='', processed=False, resumable=False)
    r['asset'] = asset
    r['id'] = id
    r['label'] = label or r['name']
    r['job'] = job
    r['group'] = 'results' if job or 'NCOMBINE' in r.get('history', {}) else r.get('detected_kind', 'exclude')
    registry[id] = r
    edited = dict(r, **workspace['overrides'].get(id, {}))
    if 'kind' in workspace['overrides'].get(id, {}) and r['group'] != 'results':
        edited['group'] = edited['kind']
    return edited


def files():
    rows = []
    try:
        for row in scan(workspace['folder'], inspector=inventory_metadata):
            rows.append(register(row['path'], inspected=row))
    except ValueError:
        pass
    for path in sorted(Path(workspace['folder']).glob('*.list')):
        if path.is_file(): rows.append(register(path))
    for j in sorted(RUNS.glob('*/products.json'), reverse=True):
        if status(j.parent)['state'] not in ('completed','partial','skipped'):
            continue
        manifest = json.loads((j.parent / 'manifest.json').read_text())
        # Keep each folder's work together.
        if manifest.get('workspace_folder') and manifest['workspace_folder'] != workspace['folder']:
            continue
        source = manifest.get('rows', [])
        if not manifest.get('workspace_folder') and not any(str(Path(r['path']).parent) == workspace['folder'] or str(r['path']).startswith(str(RUNS)) for r in source):
            continue
        for p in json.loads(j.read_text()):
            rows.append(register(j.parent / p['file'], p['label'], j.parent.name, p.get('asset')))
    return rows


def get_file(id):
    if id not in registry and id in workspace.get('file_refs', {}):
        ref=workspace['file_refs'][id]
        register(ref['path'],ref.get('label'),ref.get('job'),ref.get('asset'))
    if id not in registry:
        raise ValueError('파일을 다시 불러와 주세요.')
    path = Path(registry[id]['path'])
    if not path.is_file():
        raise ValueError(f'{registry[id].get("label") or path.name}: 파일이 없습니다.')
    return path


def delete_library(kind, ids):
    if kind not in ('files', 'jobs') or not isinstance(ids, list) or not ids or any(not isinstance(id, str) for id in ids):
        raise ValueError('삭제할 항목을 선택해 주세요.')
    ids = list(dict.fromkeys(ids))
    with lock:
        current = workflow_manager.current()
        if (current and current.get('state') in ('running', 'waiting', 'cancelling')) or any(
            status(p.parent)['state'] in ('queued', 'running', 'waiting') for p in RUNS.glob('*/manifest.json')
        ):
            raise ValueError('실행이 끝난 뒤 삭제해 주세요.')
        paths = []
        for id in ids:
            if kind == 'files':
                path = get_file(id)
                if not path.is_file():
                    raise ValueError('파일을 찾을 수 없습니다. 목록을 새로고침해 주세요.')
            else:
                path = (RUNS / id).resolve()
                if path.parent != RUNS.resolve() or not (path / 'manifest.json').is_file() or (RUNS / id).is_symlink():
                    raise ValueError('실행 기록을 찾을 수 없습니다.')
            paths.append(path)
        # Validate the whole request first; a failed trash operation never falls back to permanent deletion.
        moved_ids, moved_paths, failed_ids = [], [], []
        for id, path in zip(ids, paths):
            try:
                send2trash(str(path))
            except OSError:
                failed_ids.append(id)
            else:
                moved_ids.append(id)
                moved_paths.append(path)
        if not moved_ids:
            raise ValueError('휴지통으로 이동하지 못했습니다. 파일 권한과 휴지통을 확인한 뒤 다시 시도해 주세요.')
        ids, paths = moved_ids, moved_paths
        removed = set(ids) if kind == 'files' else {
            id for id, row in {**workspace.get('file_refs', {}), **registry}.items()
            if any(Path(row['path']).resolve().is_relative_to(path) for path in paths)
        }
        for manifest in RUNS.glob('*/products.json'):
            products = json.loads(manifest.read_text())
            kept = [p for p in products if (manifest.parent / p['file']).resolve() not in paths]
            if kept != products: atomic_json(manifest, kept)
        for id in removed:
            registry.pop(id, None)
            workspace.get('file_refs', {}).pop(id, None)
            workspace['overrides'].pop(id, None)
        for item in workspace['sets']:
            item['ids'] = [id for id in item['ids'] if id not in removed]
        if current:
            def remaining_job(job):
                if not job or (kind == 'jobs' and job['id'] in ids): return None
                return dict(job, products=[p for p in job.get('products', []) if p.get('id') not in removed])
            workflow_manager.save({'jobs': [kept for job in current.get('jobs', []) if (kept := remaining_job(job))],
                                   'currentJob': remaining_job(current.get('currentJob'))})
        save()
        return {'fileIds': sorted(removed), 'jobIds': ids if kind == 'jobs' else [], 'failedIds': failed_ids}

def resolve_rows(ids, edits):
    rows = []
    for id in ids:
        r = inspect_file(get_file(id))
        changes = edits.get(id, {})
        r.update({k: changes[k] for k in ('kind', 'filter', 'exposure') if k in changes})
        if r['kind'] == 'exclude' and r.get('resumable'):
            r['kind'] = r['detected_kind']
        r['use'] = True
        rows.append(r)
    return rows


def job_info(job):
    manifest = json.loads((job / 'manifest.json').read_text())
    result = dict(id=job.name, name=manifest.get('name') or ('영상 결합' if manifest.get('operation') == 'combine' else '전체 전처리'),
                  **status(job), count=len(manifest.get('rows', [])), settings=manifest['settings'],
                  inputs=[dict(name=r['name'], path=r['path']) for r in manifest.get('rows', [])])
    # Alignment may rewrite the manifest; the launcher record stays unchanged.
    started = job / 'process.json'
    result['createdAt'] = (started if started.exists() else job / 'manifest.json').stat().st_mtime_ns / 1_000_000
    result['execution'] = workflow_manager.membership(job.name)
    result['products']=[]
    if (job / 'products.json').exists():
        result['products'] = [dict(register(job / p['file'], p['label'], job.name, p.get('asset')), **p) for p in json.loads((job / 'products.json').read_text())]
    if manifest.get('operation')=='task':
        result.update(operation='task',task=manifest['task'],backend=manifest['backend'],manifest=manifest)
    for key,file in [('outcomes','outcomes.json'),('headerDiff','header-diff.json'),('effective','effective.json'),('interaction','interaction.json')]:
        if (job/file).exists():result[key]=json.loads((job/file).read_text())
    return result


def workflow_prepare(payload):
    def resolve(id):
        path = get_file(id)
        return register(path, registry[id].get('label'), registry[id].get('job'), registry[id].get('asset'))
    manifest = validate_task(payload, resolve)
    for row in manifest['rows']:
        registry[row['id']] = row
    return manifest


def workflow_cancel_job(id):
    job = RUNS / id
    if status(job)['state'] in ('queued', 'running', 'waiting'):
        (job / 'cancel').write_text('워크플로우 중단 요청')


from .workflow import WorkflowManager
workflow_manager = WorkflowManager(ROOT / '.workflow', workflow_prepare,
    lambda manifest: job_info(start_task(manifest, manifest.get('workingDirectory', workspace['folder']))),
    lambda id: job_info(RUNS / id), workflow_cancel_job)


def catalog_endpoint(request: Request):
    return JSONResponse(catalog(refresh=True) if request.query_params.get('refresh') == '1' else catalog())


async def workflow_diagnostics_endpoint(request: Request):
    payload = await request_payload(request) if request.method == 'POST' else {}
    def resolve_diagnostic(id):
        row = registry.get(id)
        if row is None:
            row = workspace.get('file_refs', {}).get(id)
        return row
    return JSONResponse({'diagnostics': await run_in_threadpool(workflow_diagnostics, payload, resolve_diagnostic)})


async def task_preferences_endpoint(request: Request, *, action):
    payload = await request_payload(request) if request.method == 'POST' else {}
    return await run_in_threadpool(task_preferences_response, payload, request.method, action)


def task_preferences_response(payload, method, action):
    with lock:
        store = WorkflowDocuments(workspace['folder'])
        selected = workspace.setdefault('workflow_documents', {})
        current = selected.get(workspace['folder'])
        if action == 'workflow-documents' and method == 'GET':
            return JSONResponse(store.list())
        if action == 'workflow-documents':
            if (workflow_manager.current() or {}).get('state') in ('running', 'waiting', 'confirmation', 'cancelling'):
                raise ValueError('실행을 마친 뒤 워크플로우를 전환해 주세요.')
            data = document_action(store, current, payload)
            selected[workspace['folder']] = data
            save()
            return JSONResponse(data)
        if method == 'POST':
            if '_document' not in payload:
                payload = {**payload, '_document': (current or store.new())['_document']}
            store.write(payload)
            refs = workspace.setdefault('file_refs', {})
            for id, row in registry.items():
                refs[id] = {k: row.get(k) for k in ('path', 'label', 'job', 'asset')}
            if not current or current['_document']['path'] == payload['_document']['path']:
                selected[workspace['folder']] = payload
            save()
            data = payload
        else:
            if current:
                path = current['_document']['path']
                data = store.read(path) if Path(path).is_file() else current
            else:
                data = initial_preferences(store, workspace)
                selected[workspace['folder']] = data
                save()
        data = dict(data)
        data['files'] = [register(r['path'], r.get('label'), r.get('job'), r.get('asset')) for r in workspace.get('file_refs', {}).values() if Path(r['path']).is_file()]
        return JSONResponse(data)


async def workflow_endpoint(request: Request):
    return JSONResponse(workflow_manager.current())


async def workflow_run_endpoint(request: Request, *, action):
    payload = await request_payload(request) if request.method == 'POST' else {}
    if action == 'workflow-run':
        payload = WorkflowRequest.model_validate(payload).model_dump(exclude_unset=True)
        if any(status(p.parent)['state'] in ('queued','running','waiting') for p in RUNS.glob('*/manifest.json')):
            raise ValueError('실행 중인 작업이 끝난 뒤 워크플로우를 실행해 주세요.')
        return JSONResponse(workflow_manager.start(payload))
    if action == 'workflow-cancel': workflow_manager.cancel()
    else: workflow_manager.confirm(payload.get('token'))
    return JSONResponse(workflow_manager.current())


async def task_validate_endpoint(request: Request, *, action):
    payload = await request_payload(request) if request.method == 'POST' else {}
    if action == 'task-run' and (workflow_manager.current() or {}).get('state') in ('running','waiting','confirmation','cancelling'):
        raise ValueError('워크플로우가 실행 중입니다.')
    def resolve(id):
        path=get_file(id)
        return register(path,registry[id].get('label'),registry[id].get('job'),registry[id].get('asset'))
    manifest=await run_in_threadpool(validate_task,payload,resolve)
    for row in manifest['rows']:registry[row['id']]=row
    if action=='task-validate':
        return JSONResponse(dict(preview=await run_in_threadpool(preview_task,manifest),filePlan=manifest['filePlan'],effective=manifest,errors=[],warnings=manifest.get('warnings', [])))
    authorize_file_plan(manifest,payload.get('fileConfirmation'))
    job=await run_in_threadpool(start_task,manifest,workspace['folder'])
    return JSONResponse(job_info(job))


async def header_endpoint(request: Request):
    q = request.query_params
    path=get_file(q['id'])
    with fits.open(path) as hdus:
        return JSONResponse(dict(cards=[dict(hdu=i,key=c.keyword,value=str(c.value),comment=c.comment) for i,h in enumerate(hdus) for c in h.header.cards]))


async def task_respond_endpoint(request: Request, *, action):
    q = request.query_params
    payload = await request_payload(request) if request.method == 'POST' else {}
    id=payload.get('id') if request.method=='POST' else q.get('id')
    job=(RUNS/str(id)).resolve()
    if job.parent!=RUNS.resolve() or not (job/'manifest.json').exists():raise ValueError('실행을 찾을 수 없습니다.')
    if action=='task-graphics':
        path=job/'interactive.svg'
        if not path.exists():raise ValueError('아직 그래픽이 없습니다.')
        return FileResponse(path,media_type='image/svg+xml',headers={'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'"})
    if action=='task-cancel':
        if status(job)['state'] not in ('queued','running','waiting'):raise ValueError('진행 중인 실행이 아닙니다.')
        (job/'cancel').write_text('사용자 중단 요청')
    else:
        interaction=json.loads((job/'interaction.json').read_text())
        if interaction['state']!='waiting' or payload.get('requestId')!=interaction['id']:raise ValueError('이전 입력 요청입니다. 현재 세션을 다시 확인해 주세요.')
        value=str(payload.get('value',''))
        if len(value)>200000 or '\x00' in value or (interaction['kind']!='editor' and any(c in value for c in '\n\r')):raise ValueError('응답 형식과 길이를 확인해 주세요.')
        if interaction['kind']=='cursor':
            import re
            if not re.fullmatch(r'[-+\d.eE]+\s+[-+\d.eE]+\s+\d+\s+\S(?:\s+.*)?',value):raise ValueError('커서는 x y wcs key [명령] 형식입니다.')
        with lock:
            folder=job/'responses';folder.mkdir(exist_ok=True);path=folder/(interaction['id']+'.json')
            if path.exists():raise ValueError('이미 응답한 요청입니다.')
            atomic_json(path,{'value':value})
    return JSONResponse({'ok':True})


async def text_endpoint(request: Request):
    q = request.query_params
    path=get_file(q['id'])
    if registry[q['id']].get('asset') not in ('text','image-list'): raise ValueError('텍스트 결과를 선택해 주세요.')
    return JSONResponse({'text':path.read_text(errors='replace')[:200000]})


async def plot_endpoint(request: Request):
    q = request.query_params
    path=get_file(q['id'])
    if registry[q['id']].get('asset')!='plot':raise ValueError('그래프 결과를 선택해 주세요.')
    return FileResponse(path,media_type='image/svg+xml',headers={'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"})


async def workspace_endpoint(request: Request):
    rows = await run_in_threadpool(files)
    return JSONResponse(dict(folder=workspace['folder'], sets=workspace['sets'], files=rows))


async def browse_endpoint(request: Request):
    q = request.query_params
    path = Path(q.get('path', workspace['folder'])).expanduser().resolve()
    if not path.is_dir():
        raise ValueError('폴더를 찾을 수 없습니다.')
    dirs = sorted([p for p in path.iterdir() if p.is_dir() and not p.name.startswith('.')], key=lambda p: p.name.lower())
    count = sum(p.is_file() and p.suffix.lower() in ('.fits', '.fit', '.fts') for p in path.iterdir())
    extensions=('.fits','.fit','.fts','.pl','.txt','.dat','.list','.log','.gki','.bin')
    entries=await run_in_threadpool(lambda:[register(p) for p in sorted(path.iterdir()) if p.is_file() and p.suffix.lower() in extensions])
    roots=[('작업 폴더',ROOT),('홈',Path.home()),('다운로드',Path.home()/'Downloads'),('문서',Path.home()/'Documents')]
    return JSONResponse(dict(path=str(path), parent=str(path.parent),
        breadcrumbs=[dict(name=p.name or '/',path=str(p)) for p in [*reversed(path.parents),path]],
        shortcuts=[dict(name=n,path=str(p)) for n,p in roots if p.is_dir()],
        directories=[dict(name=p.name, path=str(p)) for p in dirs], files=entries, fits=count))


async def folder_endpoint(request: Request):
    payload = await request_payload(request) if request.method == 'POST' else {}
    folder = str(Path(payload['path']).expanduser().resolve())
    await run_in_threadpool(scan, folder)
    with lock:
        workspace['folder'] = folder; save()
    return JSONResponse({'ok': True})


async def delete_files_endpoint(request: Request, *, action):
    payload = await request_payload(request) if request.method == 'POST' else {}
    return JSONResponse(await run_in_threadpool(delete_library, action.removeprefix('delete-'), payload.get('ids')))


async def metadata_endpoint(request: Request):
    payload = await request_payload(request) if request.method == 'POST' else {}
    with lock:
        for id in payload['ids']:
            get_file(id)
            changes = {k:v for k,v in payload['changes'].items() if k in ('kind','filter','exposure')}
            workspace['overrides'].setdefault(id, {}).update(changes)
        save()
    return JSONResponse({'ok': True})


async def alignment_star_endpoint(request: Request):
    payload = await request_payload(request) if request.method == 'POST' else {}
    from .alignment import measure_alignment_star
    path = get_file(payload['id'])
    row = dict(registry[payload['id']], path=str(path))
    x, y = await run_in_threadpool(measure_alignment_star, row, payload['x'], payload['y'], payload.get('backend', 'cl'))
    return JSONResponse(dict(x=x, y=y))


async def info_endpoint(request: Request):
    q = request.query_params
    return JSONResponse(await run_in_threadpool(image_info, get_file(q['id'])))


async def image_endpoint(request: Request):
    q = request.query_params
    png = await run_in_threadpool(image_png, get_file(q['id']), q.get('low'), q.get('high'), q.get('stretch', 'asinh'))
    return Response(png, media_type='image/png')


async def pixel_endpoint(request: Request):
    q = request.query_params
    return JSONResponse(image_pixel(get_file(q['id']), int(q['x']), int(q['y'])))


async def validate_endpoint(request: Request, *, action):
    payload = await request_payload(request) if request.method == 'POST' else {}
    operation = payload.get('operation', 'reduction')
    settings = {k:v for k,v in payload.get('settings', {}).items() if k not in ('master_bias', 'master_darks', 'master_flats')}
    refs = payload.get('calibrations', {})
    settings['master_bias'] = str(get_file(refs['bias'][0])) if refs.get('bias') else ''
    settings['master_darks'] = [str(get_file(id)) for id in refs.get('dark', [])]
    settings['master_flats'] = [str(get_file(id)) for id in refs.get('flat', [])]
    s = Settings(**settings)
    rows = await run_in_threadpool(resolve_rows, payload['ids'], workspace['overrides'])
    errors, warnings = (validate_combination if operation == 'combine' else validate)(rows, s)
    if action == 'validate' or errors:
        return JSONResponse(dict(errors=errors, warnings=warnings), status_code=400 if action == 'run' and errors else 200)
    job = await run_in_threadpool(start, rows, s, operation, str(payload.get('name', '')).strip()[:100], workspace['folder'])
    return JSONResponse(job_info(job))


def log_tail(path: Path, characters: int) -> str:
    # UTF-8 uses at most four bytes per character. Read enough for the existing
    # character limit, including universal newline conversion used by read_text.
    byte_limit = characters * 4
    with path.open('rb') as stream:
        size = stream.seek(0, 2)
        stream.seek(max(0, size - byte_limit))
        text = stream.read(byte_limit).decode('utf-8', errors='replace')
    return text.replace('\r\n', '\n').replace('\r', '\n')[-characters:]


# Starlette runs synchronous endpoints in its threadpool, including JSON encoding.
def jobs_endpoint(request: Request):
    return JSONResponse([job_info(p.parent) for p in sorted(RUNS.glob('*/manifest.json'), reverse=True)])


def job_endpoint(request: Request):
    q = request.query_params
    id = q['id']
    job = (RUNS / id).resolve()
    if job.parent != RUNS.resolve() or not (job / 'manifest.json').exists():
        raise ValueError('실행을 찾을 수 없습니다.')
    info = job_info(job)
    if q.get('details'):
        script='commands.cl' if info.get('backend')=='cl' else 'commands.py'
        info['commands'] = (job / script).read_text() if (job / script).exists() else ''
        log, limit = (job / 'task.log', 80000) if (job / 'task.log').exists() else (job / 'worker.log', 24000)
        info['log'] = log_tail(log, limit) if log.exists() else ''
    return JSONResponse(info)


async def reveal_endpoint(request: Request):
    payload = await request_payload(request) if request.method == 'POST' else {}
    path = get_file(payload['id'])
    if not path.is_file():
        raise ValueError('파일을 찾을 수 없습니다. 파일 목록을 새로 불러와 주세요.')
    if sys.platform == 'darwin':
        command = ['open', '-R', str(path)]
    elif sys.platform == 'win32':
        command = ['explorer', '/select,', str(path)]
    else:
        command = ['xdg-open', str(path.parent)]
    try:
        await run_in_threadpool(subprocess.run, command, check=True, capture_output=True, timeout=10)
    except (OSError, subprocess.SubprocessError) as exc:
        raise ValueError('파일 위치를 열지 못했습니다. 파일 관리자를 확인한 뒤 다시 시도해 주세요.') from exc
    return JSONResponse({'ok': True})


async def download_endpoint(request: Request):
    q = request.query_params
    path = get_file(q['id'])
    name = registry[q['id']]['label']
    name = Path(name).name
    asset=registry[q['id']].get('asset','image')
    # New products already have their download name on disk. Retain the
    # historical fallback for old manifests with descriptive labels.
    if asset=='image' and name != path.name and not name.lower().endswith('.fits'): name += '.fits'
    return FileResponse(path, filename=name, media_type='application/fits' if asset=='image' else 'application/octet-stream')


api_routes = [
    Route('/catalog', catalog_endpoint, methods=['GET'], name='catalog'),
    Route('/workflow-diagnostics', workflow_diagnostics_endpoint, methods=['POST'], name='workflow-diagnostics'),
    Route('/task-preferences', partial(task_preferences_endpoint, action='task-preferences'), methods=['GET', 'POST'], name='task-preferences'),
    Route('/workflow-documents', partial(task_preferences_endpoint, action='workflow-documents'), methods=['GET', 'POST'], name='workflow-documents'),
    Route('/workflow', workflow_endpoint, methods=['GET'], name='workflow'),
    Route('/workflow-run', partial(workflow_run_endpoint, action='workflow-run'), methods=['POST'], name='workflow-run'),
    Route('/workflow-cancel', partial(workflow_run_endpoint, action='workflow-cancel'), methods=['POST'], name='workflow-cancel'),
    Route('/workflow-confirm', partial(workflow_run_endpoint, action='workflow-confirm'), methods=['POST'], name='workflow-confirm'),
    Route('/task-validate', partial(task_validate_endpoint, action='task-validate'), methods=['POST'], name='task-validate'),
    Route('/task-run', partial(task_validate_endpoint, action='task-run'), methods=['POST'], name='task-run'),
    Route('/header', header_endpoint, methods=['GET'], name='header'),
    Route('/task-respond', partial(task_respond_endpoint, action='task-respond'), methods=['POST'], name='task-respond'),
    Route('/task-cancel', partial(task_respond_endpoint, action='task-cancel'), methods=['POST'], name='task-cancel'),
    Route('/task-graphics', partial(task_respond_endpoint, action='task-graphics'), methods=['GET'], name='task-graphics'),
    Route('/text', text_endpoint, methods=['GET'], name='text'),
    Route('/plot', plot_endpoint, methods=['GET'], name='plot'),
    Route('/workspace', workspace_endpoint, methods=['GET'], name='workspace'),
    Route('/browse', browse_endpoint, methods=['GET'], name='browse'),
    Route('/folder', folder_endpoint, methods=['POST'], name='folder'),
    Route('/delete-files', partial(delete_files_endpoint, action='delete-files'), methods=['POST'], name='delete-files'),
    Route('/delete-jobs', partial(delete_files_endpoint, action='delete-jobs'), methods=['POST'], name='delete-jobs'),
    Route('/metadata', metadata_endpoint, methods=['POST'], name='metadata'),
    Route('/alignment-star', alignment_star_endpoint, methods=['POST'], name='alignment-star'),
    Route('/info', info_endpoint, methods=['GET'], name='info'),
    Route('/image', image_endpoint, methods=['GET'], name='image'),
    Route('/pixel', pixel_endpoint, methods=['GET'], name='pixel'),
    Route('/validate', partial(validate_endpoint, action='validate'), methods=['POST'], name='validate'),
    Route('/run', partial(validate_endpoint, action='run'), methods=['POST'], name='run'),
    Route('/jobs', jobs_endpoint, methods=['GET'], name='jobs'),
    Route('/job', job_endpoint, methods=['GET'], name='job'),
    Route('/reveal', reveal_endpoint, methods=['POST'], name='reveal'),
    Route('/download', download_endpoint, methods=['GET'], name='download'),
]

app = Starlette(
    routes=[Mount('/api', routes=api_routes),
            Mount('/', StaticFiles(directory=ROOT / 'web' / 'dist', html=True, check_dir=False))],
    exception_handlers={ValidationError: validation_error, ValueError: api_error,
                        KeyError: api_error, OSError: api_error, TypeError: api_error,
                        HTTPException: http_error},
)
app.add_middleware(LocalOriginMiddleware)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', 'testserver'])
