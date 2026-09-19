"""Resolve IRAF image templates with IRAF itself, without evaluating CL commands."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

from .model import inspect_file

def split_image(value):
    match=re.match(r'^(.*?)(\[.*\])?$',value.strip())
    return match.group(1),match.group(2) or ''

def safe_expression(value):
    if not isinstance(value,str) or len(value)>20000 or any(c in value for c in '\n\r\x00;!`'):
        raise ValueError('입력 표현식에는 IRAF 파일 목록, 패턴, section만 사용할 수 있습니다.')
    return value

def resolve_expression(expression,directory):
    safe_expression(expression)
    if not expression.strip():return []
    directory=Path(directory).expanduser().resolve()
    if not directory.is_dir():raise ValueError('표현식 기준 폴더가 없습니다.')
    # Isolated uparm and cache; sections parses image templates, never CL source.
    with tempfile.TemporaryDirectory(prefix='giraf-expression-') as tmp:
        script=('import json\nfrom pyraf import iraf\n'
                f'iraf.set(uparm={tmp+"/"!r})\n'
                f'iraf.chdir({str(directory)!r})\n'
                f'items=iraf.sections({expression!r},option="fullname",Stdout=1)\n'
                'print("GIRAF_EXPANSION="+json.dumps(items))\n')
        result=subprocess.run([sys.executable,'-c',script],cwd=tmp,env=dict(os.environ,PYRAF_NO_DISPLAY='1'),capture_output=True,text=True,timeout=25)
    marker=next((s for s in result.stdout.splitlines() if s.startswith('GIRAF_EXPANSION=')),None)
    if result.returncode or not marker:raise ValueError('IRAF 표현식을 해석하지 못했습니다: '+(result.stderr or result.stdout)[-2000:])
    rows=[]
    for value in json.loads(marker.split('=',1)[1]):
        path,section=split_image(value)
        p=Path(path).expanduser()
        if not p.is_absolute():p=directory/p
        if not p.is_file() and not p.suffix:p=p.with_suffix('.fits')
        p=p.resolve()
        if not p.is_file():raise ValueError(f'{value}: 파일이 없습니다.')
        r=inspect_file(p)
        r.update(id=hashlib.sha256((str(p)+section).encode()).hexdigest()[:20],section=section,label=p.name+section,asset='image')
        rows.append(r)
    if not rows:raise ValueError('표현식에 일치하는 영상이 없습니다.')
    return rows
