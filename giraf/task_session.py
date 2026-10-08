"""Durable, request-ID based text/cursor IPC for running IRAF processes."""
from collections import deque
import json
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import time
import uuid

import pexpect

from .jobs import atomic_json
from .gki_svg import render_gki

class Cancelled(Exception):pass

def ask(job,kind,prompt='',wcs=None,initial=''):
    job=Path(job);qid=uuid.uuid4().hex
    graphics=job/'interactive.gki'
    if graphics.exists():render_gki(graphics,job/'interactive.svg')
    q=dict(id=qid,kind=kind,prompt=prompt,state='waiting',wcs=wcs,initial=initial)
    atomic_json(job/'interaction.json',q)
    atomic_json(job/'status.json',dict(state='waiting',message=kind+' 입력 대기',progress=None))
    response=job/'responses'/f'{qid}.json'
    while not response.exists():
        if (job/'cancel').exists():raise Cancelled('사용자가 중단했습니다.')
        time.sleep(.05)
    value=json.loads(response.read_text())['value']
    q['state']='answered';atomic_json(job/'interaction.json',q)
    with (job/'interaction-history.jsonl').open('a') as out:out.write(json.dumps(dict(q,response=value),ensure_ascii=False)+'\n')
    atomic_json(job/'status.json',dict(state='running',message='IRAF 실행 재개',progress=None))
    return value

def install_pyraf(job):
    """Replace only the terminal/graphics transport; IRAF still computes the fit."""
    import sys
    from pyraf import gki
    job=Path(job)
    class Input:
        encoding='utf-8'
        def isatty(self):return False
        def readline(self,*args):return ask(job,'text','IRAF 질문은 실행 로그에서 확인해 주세요.')+'\n'
        def read(self,*args):return self.readline()
        def flush(self):pass
    class Kernel(gki.GkiRedirection):
        def gcur(self):
            self.filehandle.flush()
            wcs=[[float(v) for v in x] for x in self.wcs.wcs] if self.wcs and getattr(self.wcs,'wcs',None) else None
            return ask(job,'cursor','그래픽 좌표 x y wcs key [명령]. q: 현재 피팅 종료',wcs)
        def append(self,metacode):
            super().append(metacode);self.filehandle.flush()
    stream=(job/'interactive.gki').open('ab',buffering=0)
    gki.kernel=Kernel(stream)
    sys.stdin=Input()

def run_process(command,job,log,interactive=False,backend='cl'):
    """Cancelable process groups. CL uses its native cursor-file interface."""
    job=Path(job);env=dict(os.environ,PYRAF_NO_DISPLAY='1',PYTHONUNBUFFERED='1')
    env['PATH']=str(job/'bin')+os.pathsep+env.get('PATH','')
    if interactive and backend=='cl':return run_cl_terminal(command,job,log,env)
    process=subprocess.Popen(command,cwd=job,env=env,stdin=subprocess.PIPE if interactive else subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
    atomic_json(job/'engine-process.json',{'pid':process.pid})
    os.set_blocking(process.stdout.fileno(),False)
    deadline=time.monotonic()+1800
    try:
        while process.poll() is None:
            if (job/'cancel').exists():raise Cancelled('사용자가 중단했습니다.')
            if time.monotonic()>deadline:raise TimeoutError('IRAF 실행 제한 시간 30분을 초과했습니다.')
            ready,_,_=select.select([process.stdout],[],[],.08)
            if ready:
                chunk=os.read(process.stdout.fileno(),65536)
                if chunk:log.write(chunk);log.flush()
        while rest := process.stdout.read(65536):
            log.write(rest)
        log.flush()
        return process.returncode
    finally:
        if process.poll() is None:
            os.killpg(process.pid,signal.SIGTERM)
            try:process.wait(timeout=2)
            except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
        if process.stdin:process.stdin.close()
        process.stdout.close()


def terminal_text(data):
    """Terminal output without the escape sequences IRAF uses for highlighting."""
    return re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', data.decode(errors='replace'))


def read_log_since(path, offset):
    """Read this invocation's output without loading earlier invocations."""
    with Path(path).open('rb') as stream:
        stream.seek(offset)
        return stream.read().decode(errors='replace')

def edit_file(job,filename):
    path=Path(filename).resolve()
    content=path.read_text() if path.exists() else ''
    changed=ask(job,'editor',str(path),initial=content)
    path.write_text(changed)

if __name__=='__main__':
    import sys
    edit_file(sys.argv[1],sys.argv[-1])


CL_TIMEOUT_SECONDS = 1800


def run_cl_terminal(command,job,log,env):
    """Send one CL command per native prompt; task questions own the terminal.

    A -f script is not suitable here: IRAF can read its next source line as a
    response. A controlling PTY preserves the same input semantics as IRAF CL.
    """
    commands=Path(command[-1]).read_text().splitlines()
    (job/'login.cl').write_text('set uparm = "'+str(job/'uparm')+'/"\nkeep\n')
    fifo=job/'cursor.fifo'
    if not fifo.exists():os.mkfifo(fifo)
    child = pexpect.spawn(command[0], cwd=str(job), env=env, encoding=None,
                          echo=False, maxread=65536)
    child.logfile_read = log
    child.delaybeforesend = None
    # Consume ordinary output as well as prompts so expect's unmatched buffer
    # cannot grow with the log. Keep incomplete short lines for split prompts.
    # Cursor prompts also end with ':' so they precede the generic question.
    names = ['prompt', 'cursor', 'key', 'question', 'line', 'chunk', 'eof', 'timeout']
    patterns = child.compile_pattern_list([
        rb'(?:^|[\r\n])(?!ccdinstrument>)[a-z][a-z0-9_]*>[^\S\r\n]*$',
        # IRAF's text cursor mode (stdimcur/stdgcur = "text") and its
        # single-key queries such as "[Hit return to continue, q to quit]".
        rb'^[^\r\n]*(Image|Graphics) cursor(?: input|: \[x y wcs\] key \[cmd\]):[^\S\r\n]*$',
        rb'^[^\r\n]*\[[^\]\r\n]{3,200}\](?:\x1b\[[0-9;]*[A-Za-z]|[^\S\r\n])*$',
        rb'^[^\r\n]*(?:[:?]|ccdinstrument>|\((?:yes|no)\))[^\S\r\n]*$',
        rb'^[^\r\n]*[\r\n]+',
        rb'^[^\r\n]{4096}',
        pexpect.EOF, pexpect.TIMEOUT,
    ])
    recent = deque(maxlen=12)
    echo = None
    index = 0
    cursor = None
    deadline = time.monotonic() + CL_TIMEOUT_SECONDS
    finished = False
    try:
        atomic_json(job/'engine-process.json', {'pid': child.pid})
        while True:
            if (job/'cancel').exists():
                raise Cancelled('사용자가 중단했습니다.')
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('IRAF 실행 제한 시간 30분을 초과했습니다.')
            event = names[child.expect_list(patterns, timeout=min(.05, remaining))]
            if event == 'prompt':
                if cursor is not None:
                    os.close(cursor)
                    cursor = None
                # Cursor prompts show the task's own output, not the script.
                recent.clear()
                if index < len(commands):
                    echo = commands[index].strip()
                    child.sendline(commands[index].encode())
                    index += 1
            elif event == 'question':
                prompt = child.after.decode(errors='replace')[-2000:]
                value = ask(job, 'text', prompt)
                recent.clear()
                echo = value.strip()
                child.sendline(value.encode())
            elif event == 'line':
                line = terminal_text(child.after).strip()
                if line and line != echo:
                    recent.append(line)
                echo = None
            elif event == 'cursor':
                kind = 'imcur' if child.match.group(1) == b'Image' else 'gcur'
                value = ask(job, kind, '\n'.join(recent))
                recent.clear()
                echo = value.strip()  # The terminal echoes the answer back.
                child.sendline(value.encode())
            elif event == 'key':
                value = ask(job, 'key', '\n'.join([*recent, terminal_text(child.after).strip()]))
                recent.clear()
                # A single-key query reads the raw key; an empty answer is return.
                child.send(value.encode() if value else b'\r')
            elif event == 'eof':
                child.close()
                finished = True
                return child.exitstatus if child.exitstatus is not None else -child.signalstatus
            elif event == 'timeout':
                # A reader opening IRAF's native cursor FIFO is its request.
                # Keep the writer open between replies: closing it sends EOF
                # to tasks that read more than one cursor record.
                if cursor is None:
                    try:
                        cursor = os.open(fifo, os.O_WRONLY | os.O_NONBLOCK)
                    except OSError:
                        continue
                value = ask(job, 'cursor', 'x y wcs key [명령]\nq를 입력하면 피팅을 종료합니다.')
                try:
                    os.write(cursor, (value+'\n').encode())
                except BrokenPipeError:
                    os.close(cursor)
                    cursor = None
    finally:
        try:
            if not finished:
                # Pexpect owns the PTY and reaping; terminate the whole IRAF
                # group too, including tasks which outlive the CL shell.
                try:os.killpg(child.pid,signal.SIGTERM)
                except ProcessLookupError:pass
                time.sleep(.1)
                child.isalive()  # Reap an exited leader before signalling again.
                try:os.killpg(child.pid,signal.SIGKILL)
                except ProcessLookupError:pass
        finally:
            if cursor is not None:
                os.close(cursor)
            child.close()
