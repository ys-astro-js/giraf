"""Installed .par files are the authority; report fallbacks and drift explicitly."""
import csv
import hashlib
import io
import os
from pathlib import Path
import re
import shutil

def installed_root():
    return next((p for p in [Path(os.environ.get('iraf','/nonexistent')),
        Path('/opt/homebrew/opt/iraf/libexec'),Path('/usr/lib/iraf'),Path('/usr/local/lib/iraf')]
        if (p/'pkg').is_dir()),None)

class ParameterRow(list):
    """CSV fields with quote provenance for explicit empty IRAF defaults."""

    def __init__(self, fields, quoted):
        super().__init__(fields)
        self.quoted = quoted


def parameter_rows(text):
    """Tokenize IRAF's two-quote CSV dialect without stripping quoted content."""
    row, field, quote = [], [], None
    quoted = False
    quote_flags = []
    i = 0
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == quote:
                if i + 1 < len(text) and text[i + 1] == quote:
                    field.append(ch)
                    i += 1
                else:
                    quote = None
            elif ch == "\\" and i + 1 < len(text) and text[i + 1] == quote:
                i += 1
                field.append(text[i])
            else:
                field.append(ch)
        elif ch == '#' and not row and not ''.join(field).strip():
            end = text.find('\n', i)
            i = len(text) if end == -1 else end
            field = []
            continue
        elif ch == "\\" and i + 1 < len(text) and text[i + 1] == '\n':
            i += 1
        elif ch in ("'", '"') and not ''.join(field).strip():
            field = []
            quote = ch
            quoted = True
        elif ch in ',\n':
            row.append(''.join(field) if quoted else ''.join(field).strip())
            quote_flags.append(quoted)
            field, quoted = [], False
            if ch == '\n':
                if any(row):
                    yield ParameterRow(row, quote_flags)
                row, quote_flags = [], []
        elif not quoted or not ch.isspace():
            field.append(ch)
        i += 1
    if quote:
        raise ValueError('종료되지 않은 IRAF 파라미터 문자열입니다.')
    if field or row or quoted:
        row.append(''.join(field) if quoted else ''.join(field).strip())
        yield ParameterRow(row, [*quote_flags, quoted])


def parameter_number(value):
    """IRAF real literals include Fortran exponents and sexagesimal values."""
    text = str(value).strip()
    if ':' in text:
        sign = -1 if text.startswith('-') else 1
        parts = text.lstrip('+-').split(':')
        return sign * sum(float(part) / 60 ** index for index, part in enumerate(parts))
    return float(re.sub(r'[dD]', 'e', text))


def read_parameters(path):
    result = []
    for index, fields in enumerate(parameter_rows(path.read_text()), 1):
        if len(fields) < 3:
            raise ValueError(f'{path}: 파라미터 행 {index}에 이름·타입·모드가 필요합니다.')
        explicit_default = len(fields) > 3 and (bool(fields[3]) or fields.quoted[3])
        fields += [''] * max(0, 7 - len(fields))
        name, typ, mode, value, low, high = fields[:6]
        declared_type = typ
        file_checks = []
        if re.fullmatch(r'f[bnrtw]+', typ):
            checks = dict(b='binary', n='absent', r='readable', t='text', w='writable')
            file_checks = [checks[flag] for flag in typ[1:]]
            typ = 'f'
        prompt = ','.join(fields[6:]).strip()
        if not re.fullmatch(r'[A-Za-z_$][\w$]*', name) or any(p['name'] == name for p in result):
            raise ValueError(f'{path}: 잘못되거나 중복된 파라미터 이름 {name}')
        choices = [v for v in low.strip('|').split('|') if v] if '|' in low else []
        if choices:
            low = ''
        if typ == 'b':
            value = {'y': 'yes', 'n': 'no'}.get(value, value)
        if typ in ('i', 'r', 'd') and value and value != 'INDEF':
            try:
                number = parameter_number(value)
                value = int(number) if typ == 'i' and number.is_integer() else number
            except ValueError:
                pass  # Indirect references remain IRAF expressions.
        result.append(dict(name=name, type=typ, mode=mode, default=value,
                           choices=choices, min=low, max=high, prompt=prompt,
                           required='h' not in mode and not explicit_default,
                           hasDefault=explicit_default))
        if file_checks:
            result[-1].update(declaredType=declared_type, fileChecks=file_checks)
    return result

def load_installed(snapshot):
    root=installed_root();files={};fallback=[];differences=[]
    if root:
        for name,old in list(snapshot['tasks'].items()):
            sub='pkg/images/imutil' if name in ('imheader','imstatistics') else 'pkg/images/tv' if name in ('imexamine','rimexam','limexam','cimexam') else 'noao/imred/ccdred'
            path=root/sub/(name+'.par')
            if not path.exists():fallback.append(name);continue
            params=read_parameters(path)
            files[name]=dict(path=str(path),sha256=hashlib.sha256(path.read_bytes()).hexdigest())
            if params!=old:differences.append(name)
            snapshot['tasks'][name]=params
        env=root/'unix/hlib/zzsetenv.def'
        if env.exists():
            m=re.search(r'set\s+version\s*=\s*"([^"]+)"',env.read_text())
            if m:snapshot['version']=m.group(1)
    else:fallback=list(snapshot['tasks'])
    return dict(installed=bool(root),root=str(root or ''),version=snapshot['version'],definitions=files,
                schemaFingerprint=hashlib.sha256(repr(files).encode()).hexdigest(),fallback=fallback,differences=differences,
                engines={'cl':bool(shutil.which('irafcl')),'pyraf':bool(root)},
                limits={'clobber':'설치본 combine 도움말: clobber=yes는 폐기되어 IRAF가 거부합니다.',
                        'viewer':'영상 뷰어는 2D Primary HDU를 표시합니다. 다른 차원은 IRAF task와 헤더로 확인합니다.',
                        'console':'등록된 task만 실행합니다. 임의 CL 프로그램 편집기는 아닙니다.'})
