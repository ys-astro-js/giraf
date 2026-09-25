"""Resolve IRAF image templates with IRAF itself, without evaluating CL commands."""
import hashlib
import glob
import json
import os
from pathlib import Path
import re
import shlex
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


def inspect_expression(expression, directory, _lists=()):
    """Expand file templates without starting IRAF or creating a working folder."""
    safe_expression(expression)
    root = Path(directory).expanduser().resolve()
    if not root.is_dir():
        raise ValueError('표현식 기준 폴더가 없습니다.')
    pieces = []
    depth = 0
    start = 0
    for index, char in enumerate(expression):
        if char == '[': depth += 1
        elif char == ']': depth -= 1
        elif char == ',' and depth == 0:
            pieces.append(expression[start:index].strip())
            start = index + 1
    pieces.append(expression[start:].strip())
    rows = []
    for piece in pieces:
        if not piece:
            continue
        if piece.startswith('@'):
            listing = Path(piece[1:]).expanduser()
            listing = (listing if listing.is_absolute() else root / listing).resolve()
            if listing in _lists or len(_lists) >= 32:
                raise ValueError(f'{listing.name}: 목록 파일의 순환 참조 또는 과도한 중첩이 있습니다.')
            if not listing.is_file():
                raise ValueError(f'{listing.name}: 목록 파일이 없습니다.')
            if listing.stat().st_size > 2_000_000:
                raise ValueError(f'{listing.name}: 목록 파일이 너무 큽니다.')
            for line in listing.read_text(encoding='utf-8-sig').splitlines():
                line = line.strip()
                if line and not line.startswith('#'):
                    parts = shlex.split(line, comments=True)
                    if not parts:
                        continue
                    if len(parts) != 1:
                        raise ValueError(f'{listing.name}: 한 줄에 영상 경로 하나가 필요합니다.')
                    rows.extend(inspect_expression(parts[0], listing.parent, (*_lists, listing)))
            continue
        path_text, section = split_image(piece)
        path = Path(path_text).expanduser()
        path = path if path.is_absolute() else root / path
        names = glob.glob(str(path)) if glob.has_magic(str(path)) else [str(path)]
        if not names and not path.suffix:
            names = glob.glob(str(path) + '.fits')
        for name in names:
            file = Path(name)
            if not file.is_file() and not file.suffix:
                file = file.with_suffix('.fits')
            file = file.resolve()
            if not file.is_file():
                raise ValueError(f'{piece}: 파일이 없습니다.')
            row = inspect_file(file)
            row.update(id=hashlib.sha256((str(file)+section).encode()).hexdigest()[:20],
                       section=section, label=file.name+section, asset='image')
            rows.append(row)
            if len(rows) > 50000:
                raise ValueError('표현식에 일치하는 영상이 너무 많습니다.')
    if not rows:
        raise ValueError('표현식에 일치하는 영상이 없습니다.')
    return rows
