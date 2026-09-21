"""Measure alignment stars with IRAF's imexamine aperture-analysis command."""
from pathlib import Path
import math
import tempfile

from .generic_tasks import GenericTaskRun
from .jobs import atomic_json
from .task_jobs import validate_task


def parse_imexam_center(text):
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        fields = line.split()
        if len(fields) < 9:
            continue
        try:
            x, y, flux, peak = (float(fields[i]) for i in (0, 1, 6, 8))
        except ValueError:
            continue
        if all(math.isfinite(v) for v in (x, y, flux, peak)) and flux > 0 and peak > 0:
            return x, y
    raise ValueError('별 중심을 측정하지 못했습니다. 별 가까운 위치를 다시 선택해 주세요.')


def measure_alignment_star(row, x, y, backend='cl'):
    # The cursor is only a seed. IRAF supplies the subpixel center, as with DS9's a key.
    from astropy.io import fits
    x, y = float(x), float(y)
    shape = fits.getdata(row['path']).shape
    if len(shape) != 2 or not (math.isfinite(x) and math.isfinite(y) and 1 <= x <= shape[1] and 1 <= y <= shape[0]):
        raise ValueError('영상 안의 별을 선택해 주세요.')
    payload = dict(task='imexamine', backend=backend,
                   inputs={'input': [row['id']], 'image': [row['id']]},
                   cursorCommands={'imagecur': f'{x} {y} 1 a\n0 0 1 q\n'},
                   parameters={'use_display': False, 'keeplog': True, 'logfile': 'exam.log', 'wcs': 'logical'})
    manifest = validate_task(payload, lambda _: row)
    with tempfile.TemporaryDirectory(prefix='giraf-alignment-') as folder:
        job = Path(folder)
        atomic_json(job / 'manifest.json', manifest)
        GenericTaskRun(job).execute()
        log = job / 'exam.log'
        if not log.exists():
            raise ValueError('IRAF 별 중심 측정에 실패했습니다. IRAF 실행 환경을 확인해 주세요.')
        return parse_imexam_center(log.read_text())
