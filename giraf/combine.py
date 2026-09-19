"""Validation for combining images, including intermediate calibration products."""
from dataclasses import replace
from .model import validate


def validate_combination(rows, settings):
    active = [r for r in rows if r.get('use')]
    if len(active) < 2:
        return ['결합할 영상을 두 장 이상 선택해 주세요.'], []
    # Combining already processed frames is legitimate; it performs no CCD correction.
    checks = [dict(r, kind='bias', processed=False) for r in active]
    return validate(checks, replace(settings, bias=True, dark=False, flat=False,
                                   resume=False, split_bias=False, overscan=False, trim=False))
