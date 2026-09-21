"""Folder-scoped, portable workflow documents, separate from execution records."""
import json
import os
from pathlib import Path
from uuid import uuid4
from .jobs import atomic_json


class WorkflowDocuments:
    def __init__(self, folder):
        self.folder = Path(folder).resolve()

    def new(self):
        return {'_document': {'path': str(self.folder / '.giraf' / 'workflows' / f'{uuid4().hex}.json'),
                              'name': '새 워크플로우', 'saved': False},
                'taskMap': {'version': 1, 'tasks': [], 'connections': [], 'runs': [],
                            'view': {'selected': '', 'mode': 'map', 'zoom': 1, 'x': 0, 'y': 0, 'focus': False}}}

    def path(self, value):
        path = Path(value).resolve()
        if not path.is_relative_to(self.folder) or path.parent.name != 'workflows' or path.parent.parent.name != '.giraf' or path.suffix != '.json':
            raise ValueError('이 폴더의 워크플로우를 선택해 주세요.')
        return path

    def validate(self, data):
        if not isinstance(data, dict):
            raise ValueError('워크플로우 파일을 확인해 주세요.')
        graph = data.get('taskMap')
        if not isinstance(graph, dict) or not all(isinstance(graph.get(key), list) for key in ('tasks', 'connections')):
            raise ValueError('올바른 GIRAF 워크플로우 파일을 선택해 주세요.')
        if any(not isinstance(task, dict) or not isinstance(task.get('id'), str) for task in graph['tasks']):
            raise ValueError('워크플로우 작업 정보를 확인해 주세요.')
        return data

    def read(self, value):
        path = self.path(value)
        data = self.validate(json.loads(path.read_text()))
        if data.get('format') != 'giraf-workflow' or data.get('version') != 1:
            raise ValueError('지원하지 않는 워크플로우 파일입니다.')
        return {**data['preferences'], 'taskMap': data['taskMap'],
                '_document': {'path': str(path), 'name': data['name'], 'saved': True}}

    def write(self, data):
        self.validate(data)
        meta = data['_document']
        name = str(meta['name']).strip()
        if not name or len(name) > 120:
            raise ValueError('워크플로우 이름은 1~120자로 입력해 주세요.')
        path = self.path(meta['path'])
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_json(path, {'format': 'giraf-workflow', 'version': 1, 'name': name,
                           'taskMap': data['taskMap'],
                           'preferences': {k: v for k, v in data.items() if k not in ('_document', 'taskMap', 'files')}})

    def import_document(self, data):
        if isinstance(data, dict) and data.get('format') == 'giraf-workflow':
            if data.get('version') != 1:
                raise ValueError('지원하지 않는 워크플로우 파일입니다.')
            if not isinstance(data.get('preferences', {}), dict):
                raise ValueError('워크플로우 설정 정보를 확인해 주세요.')
            data = {**data.get('preferences', {}), 'taskMap': data.get('taskMap'),
                    '_document': {'name': data.get('name', '불러온 워크플로우')}}
        self.validate(data)
        graph = data['taskMap']
        if graph.get('version') != 1:
            raise ValueError('지원하지 않는 워크플로우 버전입니다.')
        if not isinstance(graph.get('runs', []), list) or not isinstance(graph.get('view', {}), dict):
            raise ValueError('워크플로우 화면 정보를 확인해 주세요.')
        for task in graph['tasks']:
            if not isinstance(task.get('task'), str) or not isinstance(task.get('label'), str):
                raise ValueError('워크플로우 작업 정보를 확인해 주세요.')
            if not all(isinstance(task.get(key), dict) for key in ('draft', 'preprocess', 'mapping', 'packageValues', 'expressions', 'filePolicy')):
                raise ValueError('워크플로우 설정 정보를 확인해 주세요.')
            if not isinstance(task.get('instrument', []), list):
                raise ValueError('워크플로우 설정 정보를 확인해 주세요.')
            if not all(isinstance(task['draft'].get(key), dict) for key in ('parameters', 'inputs', 'output', 'exam')):
                raise ValueError('워크플로우 입력 정보를 확인해 주세요.')
        for connection in graph['connections']:
            if not isinstance(connection, dict) or not isinstance(connection.get('source'), dict):
                raise ValueError('워크플로우 연결 정보를 확인해 주세요.')
            source = connection['source']
            if source.get('kind') not in ('files', 'result', 'pending') or (source['kind'] in ('files', 'result') and not isinstance(source.get('ids'), list)):
                raise ValueError('워크플로우 연결 정보를 확인해 주세요.')
        graph = {**graph, 'runs': graph.get('runs', []), 'view': {**self.new()['taskMap']['view'], **graph.get('view', {})}}
        data = {**data, 'taskMap': graph}
        draft = self.new()
        draft.update(data)
        draft['_document'] = {**self.new()['_document'], 'name': data.get('_document', {}).get('name', '불러온 워크플로우')}
        self.write(draft)
        return self.read(draft['_document']['path'])

    def list(self):
        items = []
        for directory, dirs, _ in os.walk(self.folder, followlinks=False):
            dirs[:] = sorted(d for d in dirs if not d.startswith('.') and d not in ('node_modules', '__pycache__'))
            for path in sorted((Path(directory) / '.giraf' / 'workflows').glob('*.json')):
                try:
                    data = self.read(str(path))
                    items.append({**data['_document'], 'folder': str(Path(directory).relative_to(self.folder))})
                except (ValueError, OSError, KeyError, TypeError):
                    continue
        return items
