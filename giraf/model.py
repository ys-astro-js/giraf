"""FITS inventory and preflight checks. No reduction arithmetic lives here."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
import math
import re

from astropy.io import fits

KINDS = ['bias', 'dark', 'flat', 'science', 'exclude']
PROCESSED = ('CCDPROC', 'ZEROCOR', 'DARKCOR', 'FLATCOR', 'OVERSCAN', 'TRIM', 'NCOMBINE')


@dataclass
class Settings:
    master_bias: str = ''
    master_darks: list[str] = field(default_factory=list)
    master_flats: list[str] = field(default_factory=list)
    resume: bool = False
    bias: bool = True
    dark: bool = True
    flat: bool = True
    combine: str = 'median'
    reject: str = 'none'
    nlow: int = 0
    nhigh: int = 1
    sigma: float = 3.0
    flat_scale: str = 'mode'
    dark_policy: str = 'exact'
    split_bias: bool = False
    overscan: bool = False
    biassec: str = ''
    trim: bool = False
    trimsec: str = ''
    readaxis: str = 'line'

    def to_dict(self):
        return asdict(self)


def number(value, default=None):
    try:
        n = float(value)
        return n if math.isfinite(n) else default
    except (TypeError, ValueError):
        return default


def filter_value(header, key='FILTER'):
    """Read recorded filter identity; never infer calibration metadata from names."""
    keys = ('FILTER', 'SUBSET', 'FILTERS') if key == 'FILTER' else (key,)
    for candidate in keys:
        value = str(header.get(candidate) or '').strip()
        if value:
            return value
    return ''


def inspect_file(path: Path) -> dict:
    row = dict(use=False, name=path.name, path=str(path.resolve()), kind='exclude',
               filter='', exposure=0.0, shape='', binning='', temperature=None,
               instrument='', readout='', origin='', note='', processed=False, error='')
    try:
        with fits.open(path, memmap=False) as hdus:
            h = hdus[0].header
            if h.get('NAXIS',0)<1:
                if not any(x.header.get('NAXIS',0)>0 for x in hdus):raise ValueError('영상 HDU가 없습니다.')
                h=next(x.header for x in hdus if x.header.get('NAXIS',0)>0)
            row.update(ndim=h.get('NAXIS'),hdus=len(hdus),viewer_supported=len(hdus)==1 and h.get('NAXIS')==2)
            row.update(shape=" × ".join(str(h[f'NAXIS{i}']) for i in range(1,h['NAXIS']+1)),
                       width=h['NAXIS1'], height=h.get('NAXIS2',1),
                       binning=f"{h.get('XBINNING', '?')} × {h.get('YBINNING', '?')}",
                       temperature=number(h.get('CCD-TEMP')),
                       instrument=str(h.get('INSTRUME', '')).strip(),
                       readout=str(h.get('READOUTM', '')).strip(),
                       origin=f"{h.get('XORGSUBF', '?')},{h.get('YORGSUBF', '?')}",
                       exposure=number(h.get('EXPTIME', h.get('EXPOSURE')), -1.0))
            row['calibrationMetadata'] = dict(filter=filter_value(h), exposure=number(h.get('EXPTIME'), -1.0))
            typ = str(h.get('IMAGETYP', h.get('OBSTYPE', ''))).lower()
            name = path.stem.lower()
            notes = []
            for kind, words in [('bias', ('bias', 'zero')), ('dark', ('dark',)),
                                ('flat', ('flat',)), ('science', ('light', 'object', 'science'))]:
                if any(word in typ for word in words):
                    row['kind'] = kind
                    break
            if row['kind'] == 'exclude':
                for kind in ['bias', 'dark', 'flat']:
                    if kind in name:
                        row['kind'] = kind
                        notes.append('유형: 파일명 추정')
                        break
            filt = filter_value(h)
            if not filt and row['kind'] in ('flat', 'science'):
                match = re.search(r'(?:^|_)([UBVRIugriz])(?:\d|_|$)', path.stem)
                if match:
                    filt = match[1]
                    notes.append('파일명으로 관측 필터를 추정했습니다. 확인이 필요합니다.')
            row['filter'] = filt
            row['detected_kind'] = row['kind']
            row['history'] = {k: str(h[k]) for k in PROCESSED if k in h}
            row['processed'] = bool(row['history'])
            row['resumable'] = (row['kind'] in ('dark', 'flat') and 'ZEROCOR' in h and 'CCDPROC' in h
                                and 'CCDSEC' in h
                                and (row['kind'] != 'flat' or number(h.get('CCDMEAN'), 0) > 0)
                                and not any(k in h for k in ('NCOMBINE', 'FLATCOR', 'OVERSCAN', 'TRIM')))
            if row['history']:
                notes.append('기존 이력: ' + ', '.join(row['history']))
            if row['processed'] or name.startswith(('master_', 'zero', 'reduced_')):
                row['kind'] = 'exclude'
                notes.append('기존 처리 또는 결합 결과여서 원본 목록에서 제외합니다.')
            row['use'] = row['kind'] != 'exclude'
            row['note'] = ' / '.join(notes)
    except Exception as exc:
        row['error'] = str(exc)
        row['note'] = str(exc)
    return row


def scan(folder: str, *, inspector=None) -> list[dict]:
    directory = Path(folder).expanduser().resolve()
    if not directory.is_dir():
        raise ValueError('존재하는 데이터 폴더를 입력해 주세요.')
    paths = sorted(p for p in directory.iterdir() if p.is_file() and p.suffix.lower() in ('.fits', '.fit', '.fts'))
    if not paths:
        raise ValueError('이 폴더에 FITS 파일이 없습니다. 하위 폴더는 자동 검색하지 않습니다.')
    return [(inspector or inspect_file)(p) for p in paths]


def selected(rows):
    return [r for r in rows if r['use'] and r['kind'] != 'exclude']


def section(text: str, width: int, height: int):
    match = re.fullmatch(r'\[(\d+):(\d+),(\d+):(\d+)\]', text.strip())
    if not match:
        raise ValueError('IRAF section은 [x1:x2,y1:y2] 형태의 1부터 시작하는 좌표여야 합니다.')
    x1, x2, y1, y2 = map(int, match.groups())
    if not (1 <= x1 <= x2 <= width and 1 <= y1 <= y2 <= height):
        raise ValueError('영역 좌표가 영상 범위를 벗어나거나 순서가 잘못되었습니다.')
    return x1, x2, y1, y2


def dark_for(exposure: float, times: list[float], policy: str) -> float | None:
    for t in times:
        if math.isclose(t, exposure, rel_tol=0, abs_tol=1e-6):
            return t
    if policy == 'scale' and times:
        return min(times, key=lambda t: abs(t - exposure))
    return None


def validate(rows: list[dict], s: Settings) -> tuple[list[str], list[str]]:
    errors, warnings = [], []
    active = selected(rows)
    if not active:
        return ['최소 한 장의 원본 영상을 선택해 주세요.'], []
    validate_settings(s, errors)
    validate_inputs(active, s, errors, warnings)
    groups = {kind: [r for r in active if r['kind'] == kind] for kind in KINDS}
    masters, master_rows = validate_masters(active, s, errors)
    validate_combination(groups, masters, s, errors, warnings)
    validate_resume(active, s, errors, warnings)
    validate_matching(groups, master_rows, s, errors, warnings)
    validate_sections(active, s, errors)
    if not groups['science']:
        warnings.append('Science 선택이 없어 master 보정 영상까지만 생성합니다.')
    return list(dict.fromkeys(errors)), list(dict.fromkeys(warnings))


def validate_settings(s, errors):
    if not any((s.bias, s.dark, s.flat, s.overscan, s.trim)):
        errors.append('최소 하나의 처리 단계를 선택해 주세요.')
    if s.combine not in ('median', 'average') or s.reject not in ('none', 'minmax', 'sigclip'):
        errors.append('지원하지 않는 결합 설정입니다.')
    if s.flat_scale not in ('mode', 'median', 'mean', 'none') or s.dark_policy not in ('exact', 'scale'):
        errors.append('지원하지 않는 정규화/노출시간 설정입니다.')
    if s.readaxis not in ('line', 'column') or s.sigma <= 0 or s.nlow < 0 or s.nhigh < 0:
        errors.append('rejection 또는 판독 방향 설정을 확인해 주세요.')


def validate_inputs(active, s, errors, warnings):
    if len({r['path'] for r in active}) != len(active):
        errors.append('중복 입력 영상이 있습니다.')
    for field, label in [('shape', '영상 크기'), ('binning', 'binning'), ('instrument', '검출기'),
                         ('readout', '판독 모드'), ('origin', 'subframe 원점')]:
        if len({r.get(field, '') for r in active}) > 1:
            errors.append(f'{label}가 다른 입력이 섞여 있습니다. 동일한 관측 설정별로 나누어 실행해 주세요.')
    temps = [r['temperature'] for r in active if r.get('temperature') is not None]
    if temps and max(temps) - min(temps) > 2:
        errors.append('CCD 온도 차이가 2°C보다 큽니다. 같은 온도 조건의 프레임을 선택해 주세요.')
    if len(temps) != len(active):
        warnings.append('일부 영상에 CCD 온도 정보가 없습니다. 보정 프레임과 관측 조건이 같은지 확인해 주세요.')
    for r in active:
        if r.get('error') or (r.get('processed') and not (s.resume and r.get('resumable') and r['kind'] == r.get('detected_kind'))):
            errors.append(f"{r['name']}: 처리된 영상이나 지원하지 않는 파일은 원본으로 사용할 수 없습니다.")
        if r['kind'] not in KINDS:
            errors.append(f"{r['name']}: 유형을 확인해 주세요.")
        t = number(r['exposure'])
        if t is None or t < 0 or (r['kind'] != 'bias' and t <= 0):
            errors.append(f"{r['name']}: 유효한 노출시간(초)을 입력해 주세요.")
        if r['kind'] in ('flat', 'science') and s.flat and not str(r['filter']).strip():
            errors.append(f"{r['name']}: flat 매칭에 필요한 필터를 입력해 주세요.")


def validate_masters(active, s, errors):
    masters = {'bias': [s.master_bias] if s.master_bias else [], 'dark': s.master_darks, 'flat': s.master_flats}
    master_rows = {k: [inspect_file(Path(p)) for p in paths] for k, paths in masters.items()}
    for kind, refs in master_rows.items():
        for r in refs:
            if r.get('error') or r.get('detected_kind') != kind:
                errors.append(f"{r['name']}: {kind} 기준 영상으로 사용할 수 없습니다.")
            for key in ('instrument', 'readout', 'origin'):
                if r.get(key) and active[0].get(key) and r[key] != active[0][key]:
                    errors.append(f"{r['name']}: 입력과 master의 검출기/판독 설정이 다릅니다.")
            if r.get('temperature') is not None and active[0].get('temperature') is not None and abs(r['temperature'] - active[0]['temperature']) > 2:
                errors.append(f"{r['name']}: 입력과 master의 CCD 온도 차이가 2°C보다 큽니다.")
            if kind == 'dark' and number(r.get('exposure'), 0) <= 0:
                errors.append(f"{r['name']}: master dark 노출시간이 올바르지 않습니다.")
            if r.get('shape') != active[0].get('shape') or r.get('binning') != active[0].get('binning'):
                errors.append(f"{r['name']}: 입력과 master의 크기/binning이 다릅니다.")
    if any(masters.values()) and (s.trim or s.overscan):
        errors.append('기존 master 사용 시에는 동일한 영역으로 준비된 입력을 사용하세요. 이 모드에서는 overscan/trim을 새로 적용하지 않습니다.')
    if len({r['exposure'] for r in master_rows['dark']}) != len(master_rows['dark']):
        errors.append('노출시간이 같은 master dark가 중복되었습니다.')
    if len({r['filter'] for r in master_rows['flat']}) != len(master_rows['flat']):
        errors.append('필터가 같은 master flat이 중복되었습니다.')
    return masters, master_rows


def validate_combination(groups, masters, s, errors, warnings):
    for enabled, kind in [(s.bias, 'bias'), (s.dark, 'dark'), (s.flat, 'flat')]:
        if enabled and not groups[kind] and not masters[kind]:
            errors.append(f'{kind} 단계가 켜져 있지만 선택된 {kind} 프레임이 없습니다.')
    if s.dark and not s.bias:
        errors.append('이 MVP에서 master dark를 만들려면 bias 보정이 필요합니다.')
    if s.flat and not s.bias:
        errors.append('이 MVP에서 master flat을 만들려면 bias 보정이 필요합니다.')
    if s.split_bias and s.bias and len(groups['bias']) != 10:
        errors.append('수업의 5장씩 두 묶음 결합은 bias를 정확히 10장 선택해야 합니다.')
    combine_groups = []
    if s.bias:
        combine_groups += [('bias', groups['bias'][:5]), ('bias', groups['bias'][5:])] if s.split_bias else [('bias', groups['bias'])]
    if s.dark:
        combine_groups += [(f'dark {t}s', [r for r in groups['dark'] if r['exposure'] == t]) for t in {r['exposure'] for r in groups['dark']}]
    if s.flat:
        combine_groups += [(f'flat {f}', [r for r in groups['flat'] if r['filter'] == f]) for f in {r['filter'] for r in groups['flat']}]
    for label, group in combine_groups:
        if not group:
            continue
        if len(group) < 3:
            warnings.append(f'{label}: {len(group)}장 결합입니다. 잡음과 이상치 억제가 제한됩니다.')
        if s.reject == 'minmax' and len(group) <= s.nlow + s.nhigh:
            errors.append(f'{label}: minmax 제거 후 최소 한 장이 남아야 합니다.')
        if s.reject == 'sigclip' and len(group) < 3:
            errors.append(f'{label}: 이 UI에서 sigma clipping은 최소 3장이 필요합니다.')


def validate_resume(active, s, errors, warnings):
    resumed = [r for r in active if r.get('processed') and s.resume]
    if resumed:
        warnings.append('기존 bias/dark 보정 이력을 유지하고 완료된 보정은 건너뜁니다. 이전 보정에 사용한 master와 이번 master의 일치 여부는 검증되지 않았습니다. 원시 자료부터의 일관된 재보정이 필요하면 원본을 사용하세요.')
        if s.overscan or s.trim:
            errors.append('부분 보정 입력을 이어서 사용할 때는 이 MVP에서 overscan/trim을 새로 적용할 수 없습니다.')
        for r in resumed:
            if not s.dark and 'DARKCOR' in r.get('history', {}):
                warnings.append('Dark 단계를 꺼도 입력에 이미 적용된 dark 보정은 취소되지 않습니다.')


def validate_matching(groups, master_rows, s, errors, warnings):
    if s.dark:
        times = [number(r['exposure'], -1) for r in (master_rows['dark'] or groups['dark'])]
        for r in groups['science'] + (groups['flat'] if s.flat and not s.master_flats else []):
            if s.resume and 'DARKCOR' in r.get('history', {}):
                continue
            t = number(r['exposure'], -1)
            chosen = dark_for(t, times, s.dark_policy)
            if chosen is None:
                errors.append(f"{r['name']}: {t:g}s에 맞는 dark가 없습니다. 해당 노출의 dark를 추가하거나 선형 스케일을 선택해 주세요.")
        if s.dark_policy == 'scale':
            warnings.append('Dark 스케일은 bias를 뺀 암전류가 노출시간에 선형이라는 가정입니다. 같은 온도와 판독 조건에서만 사용하세요.')
    if s.flat:
        filters = {r['filter'] for r in (master_rows['flat'] or groups['flat'])}
        for f in {r['filter'] for r in groups['science']} - filters:
            errors.append(f'{f} 필터의 flat이 없습니다.')


def validate_sections(active, s, errors):
    for enabled, value, label in [(s.overscan, s.biassec, 'Overscan'), (s.trim, s.trimsec, 'Trim')]:
        if enabled:
            try:
                section(value, active[0].get('width', 0), active[0].get('height', 0))
            except ValueError as exc:
                errors.append(f'{label}: {exc}')
