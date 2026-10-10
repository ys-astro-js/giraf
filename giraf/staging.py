"""Names IRAF sees for a run's private copies of its input files.

IRAF writes the names it is given into the results (IMCMB001…, ZEROCOR, DARKCOR,
FLATCOR, logs), so each copy keeps its source's own name. Names IRAF cannot
handle keep a numbered alias (`s00000.fits`) instead: spaces, brackets, commas
and `@`/`$`/`%`/`*` break its file templates, non-ASCII letters are dropped from
header values, and its FITS kernel fails to open host paths longer than 230
characters (IRAF 2.18, with a 16-character node name in front).
"""
import re
from pathlib import Path

SAFE_NAME = re.compile(r'[A-Za-z0-9_][A-Za-z0-9_.+-]*\Z')
MAX_PATH = 224


def iraf_safe(path):
    """Whether IRAF can open this file under this exact name and record it."""
    return bool(SAFE_NAME.match(Path(path).name)) and len(str(path)) <= MAX_PATH


def staged_names(folder, wanted):
    """The name of each copy in `folder`, for `wanted` = [(source, name, alias)].

    A source staged twice keeps one copy. Different sources with the same name
    (ignoring case, as macOS does) keep it for the first in order and add
    `_2`, `_3`, … before the extension of the others.
    """
    chosen, taken, later = {}, set(), []
    for source, name, alias in wanted:
        if source in chosen:
            continue
        if not iraf_safe(Path(folder) / name):
            name = alias
        if name.casefold() in taken:
            chosen[source] = None
            later.append((source, name))
            continue
        taken.add(name.casefold())
        chosen[source] = name
    for source, name in later:
        stem, suffix = Path(name).stem, Path(name).suffix
        number = 2
        while f'{stem}_{number}{suffix}'.casefold() in taken:
            number += 1
        chosen[source] = f'{stem}_{number}{suffix}'
        taken.add(chosen[source].casefold())
    return [chosen[source] for source, _, _ in wanted]
