"""Process-local compatibility for the PyRAF console entry point on macOS."""

import os
from pathlib import Path
import sys


def configure():
    if sys.platform != "darwin" or Path(sys.argv[0]).name not in ("pyraf", "epyraf"):
        return

    import tkinter

    # A virtual environment may hide the Tcl/Tk resources in the base Python.
    lib = Path(sys.base_prefix) / "lib"
    for variable, directory, marker in (
        ("TCL_LIBRARY", f"tcl{tkinter.TclVersion}", "init.tcl"),
        ("TK_LIBRARY", f"tk{tkinter.TkVersion}", "tk.tcl"),
    ):
        resource = lib / directory
        if (resource / marker).is_file():
            os.environ.setdefault(variable, str(resource))

    iraf_root = Path("/opt/homebrew/opt/iraf/libexec")
    if iraf_root.is_dir():
        os.environ.setdefault("iraf", str(iraf_root) + "/")

    if tkinter.TclVersion >= 9:
        # PyRAF 2.2.4 uses Variable.trace('w', callback). Tcl 9 removed
        # "trace variable"; trace_add is its supported equivalent.
        def trace_variable(self, mode, callback):
            modes = {"r": "read", "w": "write", "u": "unset"}
            return self.trace_add(tuple(modes[letter] for letter in mode), callback)

        tkinter.Variable.trace_variable = trace_variable
        tkinter.Variable.trace = trace_variable

