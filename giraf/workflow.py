"""Server-owned sequential execution of a snapshot of the workflow graph."""
from copy import deepcopy
from pathlib import Path
import json
import re
import threading
import time
from uuid import uuid4
from .image_lists import accepts_asset
from .calibration import matches_group

def matches_files(product, patterns):
    if patterns is None:
        return True
    return any(re.fullmatch(''.join('.*' if c == '*' else '.' if c == '?' else re.escape(c) for c in pattern), product.get('label', ''), flags=re.DOTALL) for pattern in patterns)


ACTIVE = {'running', 'waiting', 'confirmation', 'cancelling'}


def workflow_order(graph):
    nodes = graph.get('nodes', [])
    ids = [n['id'] for n in nodes]
    if not ids or len(set(ids)) != len(ids):
        raise ValueError('실행할 작업을 추가해 주세요. 작업 ID는 중복될 수 없습니다.')
    incoming = {id: set() for id in ids}
    for link in graph.get('links', []):
        if link['source'] not in incoming or link['target'] not in incoming:
            raise ValueError('없는 작업에 연결되어 있습니다. 연결을 다시 설정해 주세요.')
        incoming[link['target']].add(link['source'])
    order = []
    while len(order) < len(ids):
        ready = [id for id in ids if id not in order and incoming[id].issubset(order)]
        if not ready:
            raise ValueError('순환 연결이 있습니다. 되돌아가는 연결을 해제해 주세요.')
        order.extend(ready)
    return order


def execute_workflow(graph, run, cancelled, report):
    graph = deepcopy(graph)
    order = workflow_order(graph)
    nodes = {n['id']: n for n in graph['nodes']}
    completed = {}
    state = dict(state='running', message='', jobs=[], total=len(order), done=0, currentTask='')
    try:
        for id in order:
            if cancelled():
                state.update(state='cancelled', message='워크플로우를 중단했습니다.')
                break
            node = nodes[id]
            state.update(currentTask=id, message=node['label'])
            payload = deepcopy(node['payload'])
            bindings = {}
            for link in graph.get('links', []):
                if link['target'] != id:
                    continue
                job = completed[link['source']]
                products = [p['id'] for p in job.get('products', []) if matches_files(p, link.get('sourceFiles')) and accepts_asset(link['kind'], p.get('asset', 'image')) and p.get('role') != '$log' and (not link.get('sourceGroup') or matches_group(p, link['sourceGroup'])) and (not link.get('sourceRole') or p.get('role') == link['sourceRole'])]
                if not products:
                    raise ValueError(f"{nodes[link['source']]['label']}에서 {node['label']}에 전달할 결과가 생성되지 않았습니다.")
                bindings.setdefault(link['role'], []).extend(products)
                if not link['multiple'] and len(bindings[link['role']]) > 1:
                    raise ValueError(f"{node['label']}의 {link['role']}에는 파일 한 개가 필요하지만 결과가 여러 개입니다. 입력을 파일로 지정해 주세요.")
            for role, ids in bindings.items():
                existing = payload.setdefault('inputs', {}).get(role, [])
                payload['inputs'][role] = list(dict.fromkeys(existing + ids))
            report(deepcopy(state))
            job = run(node, payload)
            state['jobs'].append(dict(job, instanceId=id))
            if cancelled() or job['state'] == 'cancelled':
                state.update(state='cancelled', message='워크플로우를 중단했습니다.')
                break
            if job['state'] == 'skipped':
                raise ValueError(f"{node['label']}에서 처리된 파일이 없습니다. 실행 기록을 확인해 주세요.")
            if job['state'] != 'completed':
                raise ValueError(f"{node['label']} 실행이 완료되지 않았습니다. 실행 기록을 확인해 주세요.")
            completed[id] = job
            state['done'] += 1
            report(deepcopy(state))
        else:
            state.update(state='completed', message='워크플로우 완료', currentTask='')
    except Exception as exc:
        state.update(state='cancelled' if cancelled() else 'failed',
                     message='워크플로우를 중단했습니다.' if cancelled() else f"{nodes.get(state['currentTask'], {}).get('label', '')}: {exc}")
    report(deepcopy(state))
    return state


class WorkflowManager:
    def __init__(self, root, prepare, launch, inspect, cancel_job):
        self.root = Path(root)
        self.prepare, self.launch, self.inspect, self.cancel_job = prepare, launch, inspect, cancel_job
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.approved = threading.Event()
        self.thread = None
        self.state = None
        history = self.root / 'memberships.json'
        self.memberships = json.loads(history.read_text()) if history.exists() else {}
        path = self.root / 'current.json'
        if path.exists():
            self.state = json.loads(path.read_text())
            if self.state['state'] in ACTIVE:
                self.state.update(state='failed', message='서버가 재시작되어 워크플로우가 중단되었습니다. 실행 기록을 확인해 주세요.')

        if self.state:
            self._record_memberships()

    def _record_memberships(self):
        jobs = list(self.state.get('jobs', []))
        current = self.state.get('currentJob')
        if current and not any(job['id'] == current['id'] for job in jobs):
            jobs.append(current)
        changed = False
        for step, job in enumerate(jobs):
            membership = {'id': self.state['id'], 'step': step}
            if self.memberships.get(job['id']) != membership:
                self.memberships[job['id']] = membership
                changed = True
        if changed:
            self.root.mkdir(parents=True, exist_ok=True)
            temporary = self.root / 'memberships.tmp'
            temporary.write_text(json.dumps(self.memberships, ensure_ascii=False))
            temporary.replace(self.root / 'memberships.json')

    def membership(self, job_id):
        with self.lock:
            return deepcopy(self.memberships.get(job_id))

    def current(self):
        with self.lock:
            result = deepcopy(self.state)
            if result:
                for job in result.get('jobs', []) + ([result['currentJob']] if result.get('currentJob') else []):
                    job['execution'] = self.membership(job['id'])
            return result

    def save(self, patch):
        with self.lock:
            self.state.update(patch)
            self.root.mkdir(parents=True, exist_ok=True)
            tmp = self.root / 'current.tmp'
            tmp.write_text(json.dumps(self.state, ensure_ascii=False))
            tmp.replace(self.root / 'current.json')
            self._record_memberships()

    def start(self, graph):
        workflow_order(graph)
        with self.lock:
            if self.thread and self.thread.is_alive():
                raise ValueError('워크플로우가 이미 실행 중입니다.')
            graph = deepcopy(graph)
            self.stop.clear()
            self.approved.clear()
            self.state = dict(id=uuid4().hex, state='running', jobs=[], total=len(graph['nodes']), done=0, currentTask='', message='', currentJob=None, plan=None)
            self.save({'graph': graph})
            self.thread = threading.Thread(target=self._execute, args=(graph,), daemon=True)
            self.thread.start()
            return self.current()

    def _execute(self, graph):
        execute_workflow(graph, self._run, self.stop.is_set, self.save)
        self.save({'currentJob': None, 'plan': None})

    def _run(self, node, payload):
        manifest = self.prepare(payload)
        plan = manifest['filePlan']
        if plan['destructive']:
            self.approved.clear()
            self.save({'state': 'confirmation', 'plan': plan, 'message': node['label']})
            while not self.approved.wait(.1):
                if self.stop.is_set():
                    raise ValueError('중단됨')
        if self.stop.is_set():
            raise ValueError('중단됨')
        manifest['workflowId'] = self.state['id']
        manifest['workflowStep'] = len(self.state['jobs'])
        manifest['fileAuthorized'] = True
        self.save({'state': 'running', 'plan': None})
        job = self.launch(manifest)
        self.save({'currentJob': job})
        while job['state'] in ('queued', 'running', 'waiting'):
            if self.stop.is_set():
                try:
                    self.cancel_job(job['id'])
                except ValueError:
                    pass
            time.sleep(.2)
            job = self.inspect(job['id'])
            self.save({'currentJob': job, 'state': 'cancelling' if self.stop.is_set() else 'waiting' if job['state'] == 'waiting' else 'running'})
        return job

    def confirm(self, token):
        with self.lock:
            if not self.state or self.state['state'] != 'confirmation' or token != self.state['plan']['token']:
                raise ValueError('현재 파일 변경 계획을 다시 확인해 주세요.')
            self.approved.set()

    def cancel(self):
        self.stop.set()
