"""Workflow selection actions and one-time migration of legacy preferences."""


def document_action(store, current, payload):
    op = payload.get('operation')
    if op == 'open': data = store.read(payload['path'])
    elif op == 'new': data = store.new()
    elif op == 'import': data = store.import_document(payload['document'])
    elif op == 'duplicate':
        if not current:
            raise ValueError('복제할 워크플로우를 선택해 주세요.')
        paths = payload.get('paths', [current['_document']['path']])
        if not isinstance(paths, list) or not paths or not all(isinstance(path, str) for path in paths):
            raise ValueError('복제할 워크플로우를 선택해 주세요.')
        originals = [current if path == current['_document']['path'] and not store.path(path).is_file()
                     else store.read(path) for path in dict.fromkeys(paths)]
        copies = [store.duplicate(original) for original in originals]
        data = copies[0] if len(copies) == 1 else current
    elif op == 'delete':
        store.delete(payload.get('paths'))
        data = current if current and current['_document']['path'] not in payload['paths'] else store.new()
    else: raise ValueError('지원하지 않는 워크플로우 동작입니다.')
    return data


def initial_preferences(store, workspace):
    choices = store.list()
    data = store.read(choices[0]['path']) if choices else store.new()
    # Migrate the old global draft exactly once, in its original folder.
    legacy = workspace.get('task_preferences')
    if legacy and legacy.get('taskMap'):
        data = {**legacy, '_document': {**store.new()['_document'], 'name': '워크플로우'}}
        store.write(data)
        workspace.pop('task_preferences', None)
    return data
