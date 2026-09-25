"""Read-only checks of the workflow currently shown in the editor."""
from pathlib import Path
import json

from .model import inspect_file
from .task_catalog import TASKS, CALIBRATIONS
from .task_jobs import validate_task, values


def workflow_diagnostics(request, resolve):
    nodes = request.get('nodes', [])
    connections = request.get('connections', [])
    if not isinstance(nodes, list) or not isinstance(connections, list):
        raise ValueError('워크플로우 노드와 연결 목록이 필요합니다.')
    by_id = {node['id']: node for node in nodes}
    if len(by_id) != len(nodes):
        raise ValueError('중복된 노드 ID가 있습니다.')
    result = []

    def add(severity, message, node_id, connection_id=None):
        identity = [node_id, connection_id, severity, message]
        result.append(dict(id=json.dumps(identity, ensure_ascii=False), severity=severity,
                           message=message, nodeId=node_id,
                           **({'connectionId': connection_id} if connection_id else {})))

    def reaches(start, goal, seen=None):
        if start == goal:
            return True
        seen = seen or set()
        if start in seen:
            return False
        seen.add(start)
        return any(c.get('source', {}).get('taskId') == start and
                   reaches(c.get('target'), goal, seen) for c in connections)

    pending = {node['id']: set() for node in nodes}
    correction_flags = {'zero': 'zerocor', 'dark': 'darkcor', 'flat': 'flatcor',
                        'illum': 'illumcor', 'fringe': 'fringecor', 'fixfile': 'fixpix'}
    for edge in connections:
        target_id = edge.get('target')
        target = by_id.get(target_id)
        source = edge.get('source', {})
        edge_id = edge.get('id')
        if not target:
            continue
        spec = TASKS.get(target['payload'].get('task'))
        if not spec:
            continue
        roles = list(spec['inputs']) + (CALIBRATIONS if spec.get('preprocess') else [])
        if spec.get('adapter') != 'generic':
            roles.append(dict(name='instrument', kind='text', multiple=False))
        slot = next((role for role in roles if role['name'] == edge.get('role')), None)
        if not slot:
            add('error', '지원하지 않는 입력 연결입니다.', target_id, edge_id)
            continue
        flag = correction_flags.get(slot['name']) if spec.get('adapter') != 'generic' else None
        if flag and not (spec['name'] == 'mkskyflat' and slot['name'] == 'flat'):
            settings = target['payload'].get('parameters', {}) if spec['name'] == 'ccdproc' else target['payload'].get('ccdproc', {})
            uses_prep = spec['name'] == 'ccdproc' or spec.get('preprocess') and (
                target['payload'].get('parameters', {}).get('process') == 'yes' or spec['name'].startswith('mk'))
            try:
                enabled = uses_prep and values('ccdproc', settings)[flag] == 'yes'
            except ValueError:
                enabled = True  # The node's parameter check reports the invalid value.
            if not enabled:
                add('error', '비활성 입력 역할에 연결되어 있습니다.', target_id, edge_id)
                continue
        if not slot.get('multiple', False) and sum(c.get('target') == target_id and c.get('role') == slot['name'] for c in connections) > 1:
            add('error', '입력 연결은 하나만 선택해 주세요.', target_id, edge_id)
            continue
        parent_id = source.get('taskId')
        if source.get('kind') in ('pending', 'result'):
            parent = by_id.get(parent_id)
            if not parent:
                add('error', '출발 작업이 삭제되었습니다.', target_id, edge_id)
                continue
            if reaches(target_id, parent_id):
                add('error', '순환 연결은 만들 수 없습니다.', target_id, edge_id)
                continue
            parent_spec = TASKS.get(parent['payload'].get('task'))
            outputs = parent_spec.get('outputs', []) if parent_spec else []
            output_role = source.get('outputRole')
            kinds = [s['kind'] for s in outputs if not output_role or s['name'] == output_role]
            if not kinds and not output_role and parent_spec and parent_spec.get('adapter') != 'generic':
                kinds = [parent_spec.get('kind', 'image')]
            if not kinds or not any(k == slot['kind'] or k == 'image-list' and slot['kind'] in ('image', 'text') for k in kinds):
                add('error', '출력과 입력의 자료형 또는 출력 역할이 맞지 않습니다.', target_id, edge_id)
                continue
            if source.get('kind') == 'pending' and not target['payload'].get('expressions', {}).get(slot['name']):
                pending[target_id].add(slot['name'])
        elif source.get('kind') not in ('files',):
            add('error', '알 수 없는 연결 출처입니다.', target_id, edge_id)
        if source.get('kind') == 'files' and not slot.get('multiple', False) and len(source.get('ids', [])) > 1:
            add('error', '입력 파일은 한 개만 선택해 주세요.', target_id, edge_id)

    def fresh(file_id):
        row = resolve(file_id)
        if not row:
            raise ValueError('선택한 파일을 다시 불러와 주세요.')
        path = Path(row['path'])
        if not path.is_file():
            raise ValueError(f'{path.name}: 파일이 없습니다.')
        if row.get('asset', 'image') == 'image':
            inspected = inspect_file(path)
            return {**row, **inspected, 'asset': 'image'}
        return row

    for node in nodes:
        node_id = node['id']
        payload = {**node['payload'], 'workingDirectory': request.get('workingDirectory') or node['payload'].get('workingDirectory')}
        try:
            manifest = validate_task(payload, fresh, diagnostics=True, pending_roles=pending[node_id])
        except (ValueError, KeyError, TypeError, OSError) as exc:
            add('error', str(exc), node_id)
            continue
        for warning in manifest.get('warnings', []):
            add('warning', warning, node_id)
    return result
