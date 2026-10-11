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


class IssuesFound(ValueError):
    """Raised by Issues.halt when collected errors stop the check; it reads as
    the first of them."""


class Issues:
    """The problems of one node's check.

    A run refuses on its first error: `check` lets it through unchanged. The
    diagnostics collect instead (`collect=True`): each `check` block is one
    independent check, its error is kept and the next check goes on. A check
    that needs an earlier one's result asks `failed(field)` or `halt()`s.
    """

    def __init__(self, collect=False):
        self.collect = collect
        self.errors = []
        self.warnings = []
        self.failed_fields = set()

    @contextmanager
    def check(self, field=None):
        """One independent check; its problem names `field` unless it names its own."""
        try:
            yield
        except IssuesFound:
            raise
        except ValueError as exc:
            if field and not isinstance(exc, FieldError):
                problem = FieldError(field, str(exc))
                if not self.collect:
                    raise problem from exc
            else:
                problem = exc
                if not self.collect:
                    raise
            self.error(problem)
            self.failed_fields.add(field or field_of(problem))

    def error(self, problem):
        """A problem found without raising: a run refuses on it."""
        if not self.collect:
            raise problem
        if not any(str(e) == str(problem) and field_of(e) == field_of(problem) for e in self.errors):
            self.errors.append(problem)

    def warn(self, warning):
        if warning not in self.warnings:
            self.warnings.append(warning)

    def failed(self, field):
        """Did a check of `field` fail? Checks needing its files skip it."""
        return field in self.failed_fields

    def halt(self):
        """Stop here when the rest needs what failed."""
        if self.errors:
            raise IssuesFound(str(self.errors[0]))
