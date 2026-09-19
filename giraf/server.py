"""Local workbench API. Files are referenced by registered IDs, never shell text."""
from __future__ import annotations
from functools import lru_cache
from pathlib import Path
import hashlib
import io
import json
import math
import threading

import numpy as np
from astropy.io import fits
from PIL import Image
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Route, Mount
from starlette.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.concurrency import run_in_threadpool

from .jobs import ROOT, RUNS, start, status, atomic_json
from .model import Settings, inspect_file, scan, validate
from .combine import validate_combination
from .task_catalog import catalog
from .task_jobs import validate_task, preview_task, start_task, authorize_file_plan

STATE = ROOT / '.workspace.json'
registry: dict[str, dict] = {}
lock = threading.Lock()
workspace = json.loads(STATE.read_text()) if STATE.exists() else {'folder': str(ROOT), 'sets': [], 'overrides': {}}


def save():
    atomic_json(STATE, workspace)


def register(path, label=None, job=None, asset=None):
    path = Path(path).resolve()
    id = hashlib.sha256(str(path).encode()).hexdigest()[:20]
    asset = asset or ('image-list' if path.suffix.lower()=='.list' else 'image' if path.suffix.lower() in ('.fits','.fit','.fts') else 'mask' if path.suffix.lower()=='.pl' else 'metacode' if path.suffix.lower()=='.gki' else 'binary' if path.suffix.lower()=='.bin' else 'text')
    r = inspect_file(path) if asset=='image' else dict(path=str(path),name=path.name,kind='exclude',detected_kind='exclude',
          filter='',exposure=0,shape='',history={},error='',note='',processed=False,resumable=False)
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
        for row in scan(workspace['folder']):
            rows.append(register(row['path']))
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
    return Path(registry[id]['path'])


@lru_cache(maxsize=5)
def image_data(path, modified):
    with fits.open(path, memmap=False) as h:
        data = np.asarray(h[0].data, dtype=np.float32)
        if data.ndim != 2:
            raise ValueError('2D 영상만 표시할 수 있습니다.')
        return data, str(h[0].header)


def data_for(id):
    path = get_file(id)
    return image_data(str(path), path.stat().st_mtime_ns)


def clean_float(x):
    return float(x) if math.isfinite(float(x)) else None


def image_info(id):
    a, header = data_for(id)
    finite = a[np.isfinite(a)].astype(float)
    if not finite.size:
        raise ValueError('유효한 픽셀이 없습니다.')
    hist, bins = np.histogram(finite, bins=100, range=tuple(np.percentile(finite, [.2, 99.8])) if np.ptp(finite) else None)
    return dict(width=a.shape[1], height=a.shape[0], mean=float(finite.mean()), median=float(np.median(finite)),
                std=float(finite.std()), min=float(finite.min()), max=float(finite.max()),
                low=float(np.percentile(finite, 1)), high=float(np.percentile(finite, 99.5)),
                header=header, histogram=hist.tolist(), bins=bins.tolist())


def image_png(id, low=None, high=None, stretch='asinh'):
    a, _ = data_for(id)
    # Keep every detector pixel so the viewer's 1:1 mode is actually native.
    small = a
    lo = float(low) if low is not None else float(np.nanpercentile(small, 1))
    hi = float(high) if high is not None else float(np.nanpercentile(small, 99.5))
    if not math.isfinite(lo) or not math.isfinite(hi) or hi <= lo:
        raise ValueError('표시 상한은 하한보다 커야 합니다.')
    v = np.clip((np.flipud(small) - lo) / (hi - lo), 0, 1)
    if stretch == 'asinh':
        v = np.arcsinh(v * 10) / np.arcsinh(10)
    v = np.nan_to_num(v, nan=0)
    image = Image.fromarray((v * 255).astype('uint8'))
    out = io.BytesIO(); image.save(out, format='PNG')
    return out.getvalue()


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


async def api(request: Request):
    try:
        # Local browser only: reject cross-origin mutating requests.
        if request.method == 'POST':
            origin = request.headers.get('origin')
            if origin and origin != str(request.base_url).rstrip('/'):
                return JSONResponse({'error': '허용하지 않는 요청 출처입니다.'}, status_code=403)
        action = request.path_params['action']
        q = request.query_params
        payload = await request.json() if request.method == 'POST' else {}
        if action == 'catalog':
            return JSONResponse(catalog())
        if action == 'task-preferences':
            if request.method=='POST':
                # Validate parameter names/types at execution; drafts may be incomplete.
                with lock:
                    refs=workspace.setdefault('file_refs',{})
                    for id,row in registry.items():
                        refs[id]={k:row.get(k) for k in ('path','label','job','asset')}
                    workspace['task_preferences']=payload
                    save()
            data=dict(workspace.get('task_preferences', {}))
            data['files']=[register(r['path'],r.get('label'),r.get('job'),r.get('asset')) for r in workspace.get('file_refs',{}).values() if Path(r['path']).is_file()]
            return JSONResponse(data)
        if action == 'workflow':
            return JSONResponse(workflow_manager.current())
        if action in ('workflow-run', 'workflow-cancel', 'workflow-confirm'):
            if request.method != 'POST': raise ValueError('POST 요청이 필요합니다.')
            if action == 'workflow-run':
                if any(status(p.parent)['state'] in ('queued','running','waiting') for p in RUNS.glob('*/manifest.json')):
                    raise ValueError('실행 중인 작업이 끝난 뒤 워크플로우를 실행해 주세요.')
                return JSONResponse(workflow_manager.start(payload))
            if action == 'workflow-cancel': workflow_manager.cancel()
            else: workflow_manager.confirm(payload.get('token'))
            return JSONResponse(workflow_manager.current())
        if action in ('task-validate','task-run'):
            if action == 'task-run' and (workflow_manager.current() or {}).get('state') in ('running','waiting','confirmation','cancelling'):
                raise ValueError('워크플로우가 실행 중입니다.')
            def resolve(id):
                path=get_file(id)
                return register(path,registry[id].get('label'),registry[id].get('job'),registry[id].get('asset'))
            manifest=await run_in_threadpool(validate_task,payload,resolve)
            for row in manifest['rows']:registry[row['id']]=row
            if action=='task-validate':
                return JSONResponse(dict(preview=await run_in_threadpool(preview_task,manifest),filePlan=manifest['filePlan'],effective=manifest,errors=[]))
            authorize_file_plan(manifest,payload.get('fileConfirmation'))
            job=await run_in_threadpool(start_task,manifest,workspace['folder'])
            return JSONResponse(job_info(job))
        if action=='header':
            path=get_file(q['id'])
            with fits.open(path) as hdus:
                return JSONResponse(dict(cards=[dict(hdu=i,key=c.keyword,value=str(c.value),comment=c.comment) for i,h in enumerate(hdus) for c in h.header.cards]))
        if action in ('task-respond','task-cancel','task-graphics'):
            id=payload.get('id') if request.method=='POST' else q.get('id')
            job=(RUNS/str(id)).resolve()
            if job.parent!=RUNS.resolve() or not (job/'manifest.json').exists():raise ValueError('실행을 찾을 수 없습니다.')
            if action=='task-graphics':
                path=job/'interactive.svg'
                if not path.exists():raise ValueError('아직 그래픽이 없습니다.')
                return FileResponse(path,media_type='image/svg+xml',headers={'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'"})
            if request.method!='POST':raise ValueError('POST 요청이 필요합니다.')
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
        if action == 'text':
            path=get_file(q['id'])
            if registry[q['id']].get('asset') not in ('text','image-list'): raise ValueError('텍스트 결과를 선택해 주세요.')
            return JSONResponse({'text':path.read_text(errors='replace')[:200000]})
        if action == 'plot':
            path=get_file(q['id'])
            if registry[q['id']].get('asset')!='plot':raise ValueError('그래프 결과를 선택해 주세요.')
            return FileResponse(path,media_type='image/svg+xml',headers={'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"})
        if action == 'workspace':
            rows = await run_in_threadpool(files)
            return JSONResponse(dict(folder=workspace['folder'], sets=workspace['sets'], files=rows))
        if action == 'browse':
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
        if action == 'folder':
            folder = str(Path(payload['path']).expanduser().resolve())
            await run_in_threadpool(scan, folder)
            with lock:
                workspace['folder'] = folder; save()
            return JSONResponse({'ok': True})
        if action == 'save-set':
            ids = [i for i in payload['ids'] if i in registry]
            name = str(payload['name']).strip()[:80]
            if not ids or not name:
                raise ValueError('묶음 이름과 영상을 선택해 주세요.')
            with lock:
                item = dict(name=name, ids=ids, folder=workspace['folder'])
                for id in ids:
                    workspace.setdefault('file_refs',{})[id]={k:registry[id].get(k) for k in ('path','label','job','asset')}
                workspace['sets'] = [s for s in workspace['sets'] if not (s['name'] == name and s['folder'] == workspace['folder'])] + [item]
                save()
            return JSONResponse(item)
        if action == 'metadata':
            with lock:
                for id in payload['ids']:
                    get_file(id)
                    changes = {k:v for k,v in payload['changes'].items() if k in ('kind','filter','exposure')}
                    workspace['overrides'].setdefault(id, {}).update(changes)
                save()
            return JSONResponse({'ok': True})
        if action == 'info':
            return JSONResponse(await run_in_threadpool(image_info, q['id']))
        if action == 'image':
            png = await run_in_threadpool(image_png, q['id'], q.get('low'), q.get('high'), q.get('stretch', 'asinh'))
            return Response(png, media_type='image/png')
        if action == 'pixel':
            a, _ = data_for(q['id'])
            x, y = int(q['x']), int(q['y'])
            if not (1 <= x <= a.shape[1] and 1 <= y <= a.shape[0]):
                raise ValueError('영상 밖의 좌표입니다.')
            return JSONResponse(dict(x=x, y=y, value=clean_float(a[y-1,x-1]),
                                     row=[clean_float(v) for v in a[y-1]], column=[clean_float(v) for v in a[:,x-1]]))
        if action in ('validate', 'run'):
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
        if action == 'jobs':
            return JSONResponse([job_info(p.parent) for p in sorted(RUNS.glob('*/manifest.json'), reverse=True)])
        if action == 'job':
            id = q['id']
            job = (RUNS / id).resolve()
            if job.parent != RUNS.resolve() or not (job / 'manifest.json').exists():
                raise ValueError('실행을 찾을 수 없습니다.')
            info = job_info(job)
            if q.get('details'):
                script='commands.cl' if info.get('backend')=='cl' else 'commands.py'
                info['commands'] = (job / script).read_text() if (job / script).exists() else ''
                info['log'] = (job / 'worker.log').read_text(errors='replace')[-24000:] if (job / 'worker.log').exists() else ''
                if (job/'task.log').exists():info['log']=(job/'task.log').read_text(errors='replace')[-80000:]
            return JSONResponse(info)
        if action == 'download':
            path = get_file(q['id'])
            name = registry[q['id']]['label']
            name = Path(name).name
            asset=registry[q['id']].get('asset','image')
            if asset=='image' and not name.lower().endswith('.fits'): name += '.fits'
            return FileResponse(path, filename=name, media_type='application/fits' if asset=='image' else 'application/octet-stream')
        raise ValueError('지원하지 않는 요청입니다.')
    except (ValueError, KeyError, OSError, TypeError) as exc:
        import re
        message=str(exc)
        match=re.search(r'(?:ccdproc\.)?([A-Za-z][\w]*)[:=]',message)
        field=match.group(1) if match else 'inputs'
        return JSONResponse({'error':message,'issues':[dict(field=field,message=message)]},status_code=400)


app = Starlette(routes=[Route('/api/{action}', api, methods=['GET', 'POST']), Mount('/', StaticFiles(directory=ROOT / 'web' / 'dist', html=True, check_dir=False))])
app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', 'testserver'])
