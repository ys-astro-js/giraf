"""Marks tests that start the installed IRAF; GIRAF_SKIP_IRAF=1 leaves them out of a quick run."""
import os
import shutil
import unittest

from giraf.task_capabilities import installed_root

SKIP_IRAF = os.environ.get('GIRAF_SKIP_IRAF') == '1'


def _gate(available):
    if SKIP_IRAF:
        return unittest.skip('GIRAF_SKIP_IRAF=1')
    return unittest.skipUnless(available, 'IRAF required')


requires_iraf = _gate(installed_root())
requires_irafcl = _gate(installed_root() and shutil.which('irafcl'))
