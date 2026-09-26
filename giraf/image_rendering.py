"""FITS viewer calculations independent of HTTP and the file registry."""
from functools import lru_cache
from pathlib import Path
import io
import math

import numpy as np
from astropy.io import fits
from PIL import Image


@lru_cache(maxsize=5)
def image_data(path, modified):
    with fits.open(path, memmap=False) as h:
        data = np.asarray(h[0].data, dtype=np.float32)
        if data.ndim != 2:
            raise ValueError('2D 영상만 표시할 수 있습니다.')
        return data, str(h[0].header)


def data_for(path):
    path = Path(path)
    return image_data(str(path), path.stat().st_mtime_ns)


def clean_float(x):
    return float(x) if math.isfinite(float(x)) else None


def image_info(path):
    a, header = data_for(path)
    finite = a[np.isfinite(a)].astype(float)
    if not finite.size:
        raise ValueError('유효한 픽셀이 없습니다.')
    hist, bins = np.histogram(finite, bins=100, range=tuple(np.percentile(finite, [.2, 99.8])) if np.ptp(finite) else None)
    return dict(width=a.shape[1], height=a.shape[0], mean=float(finite.mean()), median=float(np.median(finite)),
                std=float(finite.std()), min=float(finite.min()), max=float(finite.max()),
                low=float(np.percentile(finite, 1)), high=float(np.percentile(finite, 99.5)),
                header=header, histogram=hist.tolist(), bins=bins.tolist())


def image_png(path, low=None, high=None, stretch='asinh'):
    a, _ = data_for(path)
    # Keep every detector pixel so the viewer's 1:1 mode is actually native.
    small = a
    lo = float(low) if low is not None else float(np.nanpercentile(small, 1))
    hi = float(high) if high is not None else float(np.nanpercentile(small, 99.5))
    if not math.isfinite(lo) or not math.isfinite(hi) or hi <= lo:
        raise ValueError('표시 상한은 하한보다 커야 합니다.')
    v = np.clip((np.flipud(small) - lo) / (hi - lo), 0, 1)
    if stretch == 'asinh':
        v = np.arcsinh(v * 10) / np.arcsinh(10)
    v = np.nan_to_num(v, nan=0)
    image = Image.fromarray((v * 255).astype('uint8'))
    out = io.BytesIO()
    image.save(out, format='PNG')
    return out.getvalue()


def image_pixel(path, x, y):
    a, _ = data_for(path)
    if not (1 <= x <= a.shape[1] and 1 <= y <= a.shape[0]):
        raise ValueError('영상 밖의 좌표입니다.')
    return dict(x=x, y=y, value=clean_float(a[y-1, x-1]),
                row=[clean_float(v) for v in a[y-1]], column=[clean_float(v) for v in a[:, x-1]])
