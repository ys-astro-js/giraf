#!/bin/sh
# Runs inside WSL, started by the Windows app: the bundled Linux backend on the
# given port, with the login shell's IRAF environment (iraf, PATH to irafcl).
here=$(cd "$(dirname "$0")" && pwd)
export GIRAF_PORT="$1" GIRAF_DATA="${GIRAF_DATA:-$HOME/GIRAF}" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
mkdir -p "$GIRAF_DATA"
# exec keeps this pid through the shell and Python, so the app can stop it.
echo $$ > "$HOME/.giraf/backend.pid"
exec "${SHELL:-/bin/sh}" -ilc 'cd "$0/backend" && exec ../python/bin/python3 main.py' "$here"
