"""Prepare and execute isolated generic IRAF jobs and publish their products."""
import json
from pathlib import Path
import re
import shutil
import sys

from ..jobs import atomic_json
from ..task_session import run_process, Cancelled
from ..products import publish_product
from .preparation import stage_inputs, prepare_parameters, plan_outputs, bind_outputs
from .preview import preview_generic
from .scripts import write_scripts


class GenericTaskRun:
    def __init__(self, job):
        self.job = Path(job).resolve()
        self.m = json.loads((self.job / 'manifest.json').read_text())
        self.spec = self.m['definition']
        self.expected = []
        self.calls = []

    def state(self, message, progress=None, state='running'):
        atomic_json(self.job / 'status.json', dict(state=state, message=message, progress=progress))

    def prepare(self):
        aliases = stage_inputs(self.job, self.m)
        params = prepare_parameters(self.job, self.m, aliases)
        self.expected = plan_outputs(self.m, preview_generic(self.m))
        call = bind_outputs(self.job, self.m, params, aliases, self.expected)
        self.calls = [(call, self.expected)]
        self.write_scripts()

    def write_scripts(self, only=None):
        write_scripts(self.job, self.m, self.calls, only)

    def execute(self):
        if self.spec.get('executor') == 'image-list':
            from ..image_lists import execute_image_list
            return execute_image_list(self)
        self.state('입력과 파라미터 준비 중'); self.prepare()
        with (self.job / 'task.log').open('a') as log:
            for warning in self.m.get('warnings', []):
                log.write(f'WARNING: {warning}\n')
        backend = self.m['backend']; binary = shutil.which('irafcl')
        if backend == 'cl' and not binary: raise ValueError('IRAF CL을 찾지 못했습니다.')
        outcomes = []; products = []
        atomic_json(self.job / 'engine.json', dict(backend=backend, schemaFingerprint=self.spec['schemaFingerprint'], task=self.spec['name']))
        for index, (params, expected) in enumerate(self.calls):
            if (self.job / 'cancel').exists(): raise Cancelled('사용자가 중단했습니다.')
            self.state(f'{self.spec["taskName"]} {index + 1}/{len(self.calls)} 실행 중', index / len(self.calls))
            self.write_scripts(index)
            # Archive each invocation; commands.* remain convenient for API display.
            for suffix in ('cl', 'py'): shutil.copy2(self.job / ('commands.' + suffix), self.job / f'commands-{index:03d}.{suffix}')
            command = [binary, '-f', str(self.job / 'commands.cl')] if backend == 'cl' else [sys.executable, str(self.job / 'commands.py')]
            with (self.job / 'task.log').open('ab') as log:
                start = log.tell(); code = run_process(command, self.job, log, interactive=False, backend=backend)
            text = (self.job / 'task.log').read_bytes()[start:].decode(errors='replace')
            captured = '\n'.join((self.job / p['file']).read_text(errors='replace') for p in expected if p['role'] == '$stdout' and (self.job / p['file']).exists())
            text += '\n' + captured
            failed = bool(code or 'GIRAF_GENERIC_DONE' not in text or re.search(r'(?im)^\s*(?:ERROR|PANIC|FATAL|\*\*.*Syntax error)\b', text.replace('\x07', '')))
            missing = [p['label'] for p in expected if not (self.job / p['file']).is_file()]
            failed = failed or bool(missing)
            ids = [p['source'] for p in expected if 'source' in p] or [r['id'] for r in self.m['rows']] or [self.spec['name']]
            outcomes += [dict(source=id, label=id, state='failed' if failed else 'processed', message=('출력 파일이 없습니다: ' + ', '.join(missing)) if missing else text[-3000:] if failed else 'IRAF task 완료') for id in dict.fromkeys(ids)]
            if not failed:
                for p in expected:
                    products.append(publish_product(self.job, p, len(products)))
            atomic_json(self.job / 'outcomes.json', outcomes)
        products.append(publish_product(self.job, dict(file='task.log', label=self.spec['taskName'] + '-results.txt', asset='text', role='$log'), len(products)))
        atomic_json(self.job / 'products.json', products)
        failed = sum(o['state'] == 'failed' for o in outcomes)
        state = 'failed' if failed == len(outcomes) else 'partial' if failed else 'completed'
        self.state(self.spec['taskName'] + ' ' + {'failed': '실패', 'partial': '부분 실패', 'completed': '완료'}[state], 1, state)

