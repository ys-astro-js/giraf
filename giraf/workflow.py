"""Server-owned sequential execution of a snapshot of the workflow graph."""
from copy import deepcopy
from graphlib import CycleError, TopologicalSorter
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


def matches_partition(product, partition):
    if not partition:
        return True
    headers = product.get('headers')
    if headers is None and product.get('path') and Path(product['path']).is_file():
        from astropy.io import fits
        from .model import header_values
        headers = header_values(fits.getheader(product['path']))
    return str((headers or {}).get(partition['keyword'], '')).strip() == partition['value']


def same_group(product, partition):
    """A product a partitioned iteration made belongs to that group only."""
    group = product.get('partition')
    return not group or group['keyword'] != partition['keyword'] or group['value'] == partition['value']


ACTIVE = {'running', 'waiting', 'confirmation', 'cancelling'}


def value_graph(graph, completed=None, resolve_file=None):
    from .values import ValueGraph
    runs = graph.get('values', {}).get('runs', {})
    def job_of(id):
        if completed is not None and id in completed:
            return completed[id]
        # A value from a task outside this run reads its latest run, sent by the client.
        return runs.get(id) if isinstance(runs.get(id), dict) else None
    return ValueGraph(graph.get('values') or {}, job_of, resolve_file or (lambda id: id))


def flow_owner(graph):
    """{member task id: container id} for the foreach, for and if containers."""
    owner = {}
    for flow in graph.get('flows', []):
        for member in flow.get('members', []):
            if member in owner:
                raise ValueError('한 작업은 반복이나 조건 분기 하나에만 들어갈 수 있습니다.')
            owner[member] = flow['id']
    return owner


CYCLE = '순환 연결이 있습니다. 되돌아가는 연결을 해제해 주세요.'


def _sorted(incoming, positions):
    sorter = TopologicalSorter(incoming)
    try:
        sorter.prepare()
    except CycleError as exc:
        raise ValueError(CYCLE) from exc
    order = []
    while sorter.is_active():
        # Keep the existing input order within each ready batch.
        ready = sorted(sorter.get_ready(), key=positions.__getitem__)
        order.extend(ready)
        sorter.done(*ready)
    return order


def workflow_order(graph):
    """Top-level run order: tasks outside containers and the containers themselves."""
    nodes = graph.get('nodes', [])
    ids = [n['id'] for n in nodes] + [f['id'] for f in graph.get('flows', [])]
    if not ids or len(set(ids)) != len(ids):
        raise ValueError('실행할 작업을 추가해 주세요. 작업 ID는 중복될 수 없습니다.')
    owner = flow_owner(graph)
    if set(owner) - set(ids):
        raise ValueError('반복이나 조건 분기 안에 없는 작업이 들어 있습니다. 다시 확인해 주세요.')
    unit = lambda id: owner.get(id, id)
    incoming = {id: set() for id in ids if id not in owner}
    for link in graph.get('links', []):
        if link['source'] not in ids or link['target'] not in ids:
            raise ValueError('없는 작업에 연결되어 있습니다. 연결을 다시 설정해 주세요.')
        if unit(link['source']) != unit(link['target']):
            incoming[unit(link['target'])].add(unit(link['source']))
    # A value read from a task's run (directly or through value nodes) orders it first.
    values = value_graph(graph)
    for link in values.links:
        if link['target'] not in ids:
            raise ValueError('없는 작업에 값이 연결되어 있습니다. 연결을 다시 설정해 주세요.')
    for id in ids:
        for source in _value_sources(values, id):
            if source in ids and unit(source) != unit(id):
                incoming[unit(id)].add(unit(source))
    return _sorted(incoming, {id: index for index, id in enumerate(ids)})


def _value_sources(values, id):
    """Tasks whose runs the values of `id`'s parameters read; reading its own run is a cycle."""
    sources = values.dependencies(id)
    if id in sources:
        raise ValueError(CYCLE)
    return sources


def member_order(graph, flow):
    members = list(flow.get('members', []))
    inside = set(members)
    incoming = {id: set() for id in members}
    for link in graph.get('links', []):
        if link['source'] in inside and link['target'] in inside:
            incoming[link['target']].add(link['source'])
    values = value_graph(graph)
    for id in members:
        incoming[id] |= {source for source in _value_sources(values, id) if source in inside}
    return _sorted(incoming, {id: index for index, id in enumerate(members)})


class Cancelled(Exception):
    pass


def link_products(job, link):
    return [p for p in job.get('products', []) if matches_files(p, link.get('sourceFiles')) and accepts_asset(link['kind'], p.get('asset', 'image')) and p.get('role') != '$log' and (not link.get('sourceGroup') or matches_group(p, link['sourceGroup'])) and (not link.get('sourceRole') or p.get('role') == link['sourceRole']) and matches_partition(p, link.get('sourcePartition'))]


def iteration_values(graph, flow, iteration):
    """The value request of one container iteration: the `for` variable is a
    constant, and a partition group's members take that group's values."""
    values = deepcopy(graph.get('values') or {})
    if 'number' in iteration:
        number = iteration['number']
        values['nodes'] = [n for n in values.get('nodes', []) if n['id'] != flow['id']] + [dict(
            id=flow['id'], run='value-constant', rows=[dict(name=flow['variable'], value=repr(number))])]
    partition = iteration.get('partition')
    if partition:
        # Value nodes outside the container (a shared pset) take the group too.
        for link in values.get('links', []):
            if not link.get('partition'):
                link['partition'] = partition
    return {'values': values}


def execute_workflow(graph, run, cancelled, report, resolve_file=None):
    from .flows import COLLECT, RESULTS, Items, iterations, lanes, loop_names, loop_value
    from .values import apply_parameters
    graph = deepcopy(graph)
    order = workflow_order(graph)
    nodes = {n['id']: n for n in graph['nodes']}
    flows = {f['id']: f for f in graph.get('flows', [])}
    labels = {**{id: f.get('label') or f['run'] for id, f in flows.items()}, **{id: n['label'] for id, n in nodes.items()}}
    files = Items(resolve_file or (lambda id: id))
    completed = {}
    state = dict(state='running', message='', jobs=[], total=len(order), done=0, currentTask='')

    def run_task(id, done, flow=None, iteration=None):
        node = nodes[id]
        state.update(currentTask=id, message=node['label'])
        payload = deepcopy(node['payload'])
        value = loop_value(flow, iteration, files) if flow and flow.get('variable') else None
        if value is not None:
            # Output names may read the iteration: `M67{image}.dat` is M67B.dat, M67V.dat.
            loop_names(payload, flow['variable'], value)
        bindings = {}
        for link in graph.get('links', []):
            if link['target'] != id:
                continue
            if flow and link['source'] == flow['id']:
                # The container's current item (or lane) goes to the member.
                products = [p for p in iteration['ports'].get(link.get('sourceRole'), [])
                            if 'asset' not in p or accepts_asset(link['kind'], p['asset'])]
            else:
                products = link_products(done[link['source']], link)
                if iteration and iteration.get('partition'):
                    # Another container's results pair by group: B with B.
                    products = [p for p in products if same_group(p, iteration['partition'])]
            if not products:
                raise ValueError(f"{labels[link['source']]}에서 {node['label']}에 전달할 결과가 생성되지 않았습니다.")
            bindings.setdefault(link['role'], []).extend(p['id'] for p in products)
            if not link['multiple'] and len(bindings[link['role']]) > 1:
                raise ValueError(f"{node['label']}의 {link['role']}에는 파일 한 개가 필요하지만 결과가 여러 개입니다. 입력을 파일로 지정해 주세요.")
        for role, ids in bindings.items():
            existing = payload.setdefault('inputs', {}).get(role, [])
            payload['inputs'][role] = list(dict.fromkeys(existing + ids))
        # Values are read once their sources finished, so B's group gets B's value.
        values = value_graph(iteration_values(graph, flow, iteration) if flow else graph, done, resolve_file)
        links = [link for link in values.links if link['target'] == id]
        apply_parameters(payload, links, values.parameters(id))
        report(deepcopy(state))
        job = run(node, payload)
        state['jobs'].append(dict(job, instanceId=id))
        if cancelled() or job['state'] == 'cancelled':
            raise Cancelled()
        if job['state'] == 'skipped':
            raise ValueError(f"{node['label']}에서 처리된 파일이 없습니다. 실행 기록을 확인해 주세요.")
        if job['state'] != 'completed':
            raise ValueError(f"{node['label']} 실행이 완료되지 않았습니다. 실행 기록을 확인해 주세요.")
        return job

    def run_flow(flow):
        id = flow['id']
        state.update(currentTask=id, message=labels[id])
        items = [{'id': file} for file in flow.get('files', [])]
        for link in graph.get('links', []):
            if link['target'] == id and link['role'] != COLLECT:
                items += link_products(completed[link['source']], link)
        # An `if` condition reads the values connected to its names.
        values = value_graph(graph, completed, resolve_file)
        variables = {}
        for link in values.links:
            if link['target'] == id:
                variables[link['parameter']] = values.output(link['source'])['values']
        steps = iterations(flow, items, files, variables)
        lane = {member: port for port, reached in lanes(flow, graph.get('links', [])).items() for member in reached}
        members = member_order(graph, flow)
        collected, merged = [], {}
        for index, iteration in enumerate(steps):
            if cancelled():
                raise Cancelled()
            state['flow'] = dict(id=id, index=index + 1, total=len(steps))
            done, skipped = dict(completed), set()
            for member in members:
                upstream = {l['source'] for l in graph.get('links', []) if l['target'] == member}
                # A lane without files and whatever follows it does not run.
                if (member in lane and not iteration['ports'].get(lane[member])) or upstream & skipped:
                    skipped.add(member)
                    continue
                done[member] = run_task(member, done, flow, iteration)
                job = merged.setdefault(member, dict(done[member], products=[]))
                job.update({k: v for k, v in done[member].items() if k != 'products'})
                group = iteration.get('partition')
                job['products'] = job['products'] + [dict(p, partition=group) if group else p
                                                     for p in done[member].get('products', [])]
            for link in graph.get('links', []):
                if link['target'] == id and link['role'] == COLLECT and link['source'] in flow.get('members', []) \
                        and link['source'] in done and link['source'] not in skipped:
                    collected += [dict(p, role=RESULTS, **({'partition': iteration['partition']} if iteration.get('partition') else {}))
                                  for p in link_products(done[link['source']], link)]
            report(deepcopy(state))
        state.pop('flow', None)
        # Members' links out of the container see every iteration's results.
        completed.update(merged)
        completed[id] = dict(id=id, state='completed', products=collected)

    try:
        for id in order:
            if cancelled():
                raise Cancelled()
            if id in flows:
                run_flow(flows[id])
            else:
                completed[id] = run_task(id, completed)
            state['done'] += 1
            report(deepcopy(state))
        state.update(state='completed', message='워크플로우 완료', currentTask='')
    except Cancelled:
        state.pop('flow', None)
        state.update(state='cancelled', message='워크플로우를 중단했습니다.')
    except Exception as exc:
        state.pop('flow', None)
        state.update(state='cancelled' if cancelled() else 'failed',
                     message='워크플로우를 중단했습니다.' if cancelled() else f"{labels.get(state['currentTask'], '')}: {exc}")
    report(deepcopy(state))
    return state


class WorkflowManager:
    def __init__(self, root, prepare, launch, inspect, cancel_job, resolve_file=None):
        self.root = Path(root)
        self.prepare, self.launch, self.inspect, self.cancel_job = prepare, launch, inspect, cancel_job
        self.resolve_file = resolve_file
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.approved = threading.Event()
        self.thread = None
        self.state = None
        self._saved = False
        self._snapshot_files = {}
        history = self.root / 'memberships.json'
        self.memberships = json.loads(history.read_text()) if history.exists() else {}
        path = self.root / 'current.json'
        if path.exists():
            self.state = json.loads(path.read_text())
            for field in ('graph', 'jobs'):
                filename = self.state.pop(field + 'File', None)
                if filename:
                    self._snapshot_files[field] = filename
                    self.state[field] = json.loads((self.root / filename).read_text())
            self._saved = True
            if self.state['state'] in ACTIVE:
                self.state.update(state='failed', message='서버가 재시작되어 워크플로우가 중단되었습니다. 실행 기록을 확인해 주세요.')
                self._saved = False

        if self.state:
            self._record_memberships()

    def _record_memberships(self):
        jobs = list(self.state.get('jobs', []))
        current = self.state.get('currentJob')
        if current and not any(job['id'] == current['id'] for job in jobs):
            jobs.append(current)
        updates = {}
        for step, job in enumerate(jobs):
            membership = {'id': self.state['id'], 'step': step}
            if self.memberships.get(job['id']) != membership:
                updates[job['id']] = membership
        if updates:
            memberships = {**self.memberships, **updates}
            self.root.mkdir(parents=True, exist_ok=True)
            temporary = self.root / 'memberships.tmp'
            temporary.write_text(json.dumps(memberships, ensure_ascii=False))
            temporary.replace(self.root / 'memberships.json')
            self.memberships = memberships

    def membership(self, job_id):
        with self.lock:
            return deepcopy(self.memberships.get(job_id))

    def current(self):
        with self.lock:
            result = deepcopy(self.state)
            if result:
                snapshot = self.root / 'current.json'
                if snapshot.exists():
                    result['updatedAt'] = snapshot.stat().st_mtime_ns / 1_000_000
                for job in result.get('jobs', []) + ([result['currentJob']] if result.get('currentJob') else []):
                    job['execution'] = self.membership(job['id'])
            return result

    def save(self, patch):
        with self.lock:
            if self._saved and all(key in self.state and self.state[key] == value for key, value in patch.items()):
                return
            state = {**self.state, **deepcopy(patch)}
            self.root.mkdir(parents=True, exist_ok=True)
            snapshot = dict(state)
            snapshot_files = dict(self._snapshot_files)
            for field in ('graph', 'jobs'):
                if field not in state:
                    continue
                filename = snapshot_files.get(field)
                changed = field in patch and state[field] != self.state.get(field)
                if not self._saved or not filename or changed:
                    # Alternate two files: the previous snapshot stays readable
                    # until its pointer is committed, without accumulating copies.
                    filename = f'{field}-1.json' if filename == f'{field}-0.json' else f'{field}-0.json'
                    field_tmp = self.root / (field + '.tmp')
                    field_tmp.write_text(json.dumps(state[field], ensure_ascii=False))
                    field_tmp.replace(self.root / filename)
                    snapshot_files[field] = filename
                del snapshot[field]
                snapshot[field + 'File'] = filename
            tmp = self.root / 'current.tmp'
            tmp.write_text(json.dumps(snapshot, ensure_ascii=False))
            tmp.replace(self.root / 'current.json')
            self.state = state
            self._snapshot_files = snapshot_files
            self._saved = False
            self._record_memberships()
            self._saved = True

    def start(self, graph):
        workflow_order(graph)
        with self.lock:
            if self.thread and self.thread.is_alive():
                raise ValueError('워크플로우가 이미 실행 중입니다.')
            graph = deepcopy(graph)
            self.stop.clear()
            self.approved.clear()
            self.state = dict(id=uuid4().hex, state='running', jobs=[], total=len(graph['nodes']), done=0, currentTask='', message='', currentJob=None, plan=None)
            self._saved = False
            self.save({'graph': graph})
            self.thread = threading.Thread(target=self._execute, args=(graph,), daemon=True)
            self.thread.start()
            return self.current()

    def _execute(self, graph):
        execute_workflow(graph, self._run, self.stop.is_set, self.save, self.resolve_file)
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
