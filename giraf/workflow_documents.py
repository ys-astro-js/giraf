"""Folder-scoped, portable workflow documents, separate from execution records."""
import json
import os
from pathlib import Path
from uuid import uuid4
from .jobs import atomic_json
from .document_schema import ImportedPreferences, PortableDocument, Preferences


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
        return Preferences.model_validate(data).model_dump(by_alias=True, exclude_unset=True)

    def read(self, value):
        path = self.path(value)
        data = PortableDocument.model_validate_json(path.read_text()).model_dump(exclude_unset=True)
        return self.validate({**data.get('preferences', {}), 'taskMap': data['taskMap'],
                              '_document': {'path': str(path), 'name': data['name'], 'saved': True}})

    def write(self, data):
        data = self.validate(data)
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
        if isinstance(data, dict) and 'format' in data:
            portable = PortableDocument.model_validate(data).model_dump(exclude_unset=True)
            data = {**portable.get('preferences', {}), 'taskMap': portable['taskMap'],
                    '_document': {'name': portable['name']}}
        data = ImportedPreferences.model_validate(data).model_dump(by_alias=True, exclude_unset=True)
        draft = self.new()
        graph = data['taskMap']
        graph = {**graph, 'runs': graph.get('runs', []),
                 'view': {**draft['taskMap']['view'], **graph.get('view', {})}}
        draft.update(data)
        draft['taskMap'] = graph
        draft['_document'] = {**self.new()['_document'],
                              'name': data.get('_document', {}).get('name', '불러온 워크플로우')}
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
