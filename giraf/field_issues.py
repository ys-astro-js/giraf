"""Problems that name the input or parameter they are about.

`field` is the input role (`images`, `zero`) or the parameter key as the
editor names it: `name` for the task's own, `pset.name` for a parameter set
(`datapars.fwhmpsf`, `ccdproc.max_cache`). The message stays as written, so
lists of problems read the same; the field lets the editor mark the input or
parameter where it is shown (web/src/lib/field-issues.ts).
"""
from contextlib import contextmanager


class FieldError(ValueError):
    """A ValueError about one input or parameter."""

    def __init__(self, field, message):
        super().__init__(message)
        self.field = field

    def __reduce__(self):
        return FieldError, (self.field, str(self))


class FieldWarning(str):
    """A warning message about one input or parameter; it reads as its text."""

    def __new__(cls, field, message):
        text = super().__new__(cls, message)
        text.field = field
        return text

    def __getnewargs__(self):
        return self.field, str(self)


def field_of(problem):
    """The field a problem names, or None."""
    return getattr(problem, 'field', None)


@contextmanager
def in_field(field):
    """A problem raised while checking one field names that field, unless it
    already names its own."""
    try:
        yield
    except FieldError:
        raise
    except ValueError as exc:
        raise FieldError(field, str(exc)) from exc
