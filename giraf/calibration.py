"""Read-only compatibility for previously saved filtered workflow links."""
import math
from pathlib import Path
from astropy.io import fits
from .model import filter_value

def metadata(row, mapping):
    h = fits.getheader(row['path'])
    key = mapping.get('exptime') or 'EXPTIME'
    try:
        exposure = float(h[key])
        if not math.isfinite(exposure) or exposure < 0: exposure = None
    except (KeyError, TypeError, ValueError): exposure = None
    return dict(exposure=exposure, filter=filter_value(h, mapping.get('subset') or 'FILTER'),
                shape=(h.get('NAXIS1'), h.get('NAXIS2')))



def matches_group(row, group):
    """A grouped output wire carries only the selected product partition."""
    if not isinstance(group, dict) or set(group) - {'filter', 'exposure'}:
        raise ValueError('출력 포트의 분류 조건을 확인해 주세요.')
    meta = row.get('calibrationMetadata') or row
    if row.get('path') and Path(row['path']).is_file():
        meta = metadata(row, {})
        # Port identity uses the same inspected metadata as the file browser.
        if not meta.get('filter'): meta['filter'] = row.get('filter', '')
        if meta.get('exposure') is None: meta['exposure'] = row.get('exposure')
    if 'filter' in group and (str(meta.get('filter') or '').strip() or None) != group['filter']:
        return False
    if 'exposure' in group:
        value = meta.get('exposure')
        expected = group['exposure']
        if expected is None:
            return value is None or value < 0
        return isinstance(value, (int, float)) and math.isclose(value, expected, rel_tol=0, abs_tol=1e-6)
    return True
