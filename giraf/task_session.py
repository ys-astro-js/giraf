"""Durable, request-ID based text/cursor IPC for running IRAF processes."""
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import time
import uuid
import pty
import re

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
    fifo=job/'cursor.fifo';cursor_fd=None
    if interactive and backend=='cl' and not fifo.exists():os.mkfifo(fifo)
    process=subprocess.Popen(command,cwd=job,env=env,stdin=subprocess.PIPE if interactive else subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
    atomic_json(job/'engine-process.json',{'pid':process.pid})
    os.set_blocking(process.stdout.fileno(),False)
    pending=b'';last_output=time.monotonic();last_cursor=0.;deadline=time.monotonic()+1800
    try:
        while process.poll() is None:
            if (job/'cancel').exists():raise Cancelled('사용자가 중단했습니다.')
            if time.monotonic()>deadline:raise TimeoutError('IRAF 실행 제한 시간 30분을 초과했습니다.')
            ready,_,_=select.select([process.stdout],[],[],.08)
            if ready:
                chunk=os.read(process.stdout.fileno(),65536)
                if chunk:log.write(chunk);log.flush();pending+=chunk;last_output=time.monotonic()
            if interactive and backend=='cl':
                if cursor_fd is None:
                    try:cursor_fd=os.open(fifo,os.O_WRONLY|os.O_NONBLOCK)
                    except OSError:pass
                if cursor_fd is not None and time.monotonic()-last_cursor>.2 and time.monotonic()-last_output>.15:
                    value=ask(job,'cursor','x y wcs key [명령]\nq를 입력하면 피팅을 종료합니다.')
                    os.write(cursor_fd,(value+'\n').encode());last_cursor=time.monotonic();pending=b''
                elif cursor_fd is None and pending and time.monotonic()-last_output>.2:
                    tail=pending.decode(errors='replace').strip()
                    if tail.endswith((':','?')) or '(yes)' in tail[-100:] or '(no)' in tail[-100:]:
                        value=ask(job,'text',tail[-2000:])
                        process.stdin.write((value+'\n').encode());process.stdin.flush();pending=b''
        rest=process.stdout.read()
        if rest:log.write(rest);log.flush()
        return process.returncode
    finally:
        if process.poll() is None:
            os.killpg(process.pid,signal.SIGTERM)
            try:process.wait(timeout=2)
            except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
        if cursor_fd is not None:os.close(cursor_fd)
        if process.stdin:process.stdin.close()
        process.stdout.close()

def edit_file(job,filename):
    path=Path(filename).resolve()
    content=path.read_text() if path.exists() else ''
    changed=ask(job,'editor',str(path),initial=content)
    path.write_text(changed)

if __name__=='__main__':
    import sys
    edit_file(sys.argv[1],sys.argv[-1])


def run_cl_terminal(command,job,log,env):
    """Send one CL command per native prompt; task questions own the terminal.

    A -f script is not suitable here: IRAF can read its next source line as a
    response. A controlling PTY preserves the same input semantics as IRAF CL.
    """
    commands=Path(command[-1]).read_text().splitlines()
    (job/'login.cl').write_text('set uparm = "'+str(job/'uparm')+'/"\nkeep\n')
    fifo=job/'cursor.fifo'
    if not fifo.exists():os.mkfifo(fifo)
    pid,fd=pty.fork()
    if pid==0:
        os.chdir(job);os.execvpe(command[0],[command[0]],env)
    atomic_json(job/'engine-process.json',{'pid':pid})
    pending=b'';index=0;cursor=None;last=time.monotonic();deadline=last+1800;finished=False
    try:
        while True:
            child,status=os.waitpid(pid,os.WNOHANG)
            if child:finished=True;return os.waitstatus_to_exitcode(status)
            if (job/'cancel').exists():raise Cancelled('사용자가 중단했습니다.')
            if time.monotonic()>deadline:raise TimeoutError('IRAF 실행 제한 시간 30분을 초과했습니다.')
            ready,_,_=select.select([fd],[],[],.05)
            if ready:
                try:chunk=os.read(fd,65536)
                except OSError:chunk=b''
                if chunk:log.write(chunk);log.flush();pending+=chunk;last=time.monotonic()
            tail=pending.decode(errors='replace')
            if re.search(r'(?:^|[\r\n])(?:cl|ecl|images|imutil|tv|noao|imred|ccdred)>\s*$',tail) and index<len(commands):
                os.write(fd,(commands[index]+'\n').encode());index+=1;pending=b'';last=time.monotonic();continue
            if time.monotonic()-last<.25:continue
            if cursor is None:
                try:cursor=os.open(fifo,os.O_WRONLY|os.O_NONBLOCK)
                except OSError:pass
            if cursor is not None:
                value=ask(job,'cursor','x y wcs key [명령]\nq를 입력하면 피팅을 종료합니다.')
                try:os.write(cursor,(value+'\n').encode())
                except BrokenPipeError:os.close(cursor);cursor=None
                pending=b'';last=time.monotonic()
            elif tail.strip().endswith((':','?','ccdinstrument>')) or re.search(r'\((?:yes|no)\)\s*$',tail):
                value=ask(job,'text',tail[-2000:]);os.write(fd,(value+'\n').encode());pending=b'';last=time.monotonic()
    finally:
        if not finished:
            try:os.killpg(pid,signal.SIGTERM)
            except ProcessLookupError:pass
            time.sleep(.1)
            try:os.killpg(pid,signal.SIGKILL)
            except ProcessLookupError:pass
            os.waitpid(pid,0)
        if cursor is not None:os.close(cursor)
        os.close(fd)
