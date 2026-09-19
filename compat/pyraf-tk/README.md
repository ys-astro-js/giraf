# PyRAF compatibility

Installed automatically by `uv sync` through the project's local dependency.
Continue using `uv run pyraf`.

The `.pth` startup hook activates only for the `pyraf` and `epyraf` console
commands on macOS. It locates the Tcl/Tk resources bundled with the base Python,
sets the Homebrew IRAF root if unset, and maps PyRAF's legacy Tk variable trace
calls to `trace_add` on Tcl 9. Explicit environment paths are preserved.

Verified with the project's Python 3.12.12 / PyRAF 2.2.4 / Tcl-Tk 9 environment:
`uv run pyraf` created `graphics1` and rendered an `imexamine` radial profile
using scripted `r` and `q` cursor input. Live DS9 mouse/keyboard interaction
was not part of that automated check.
