#!/bin/sh
# Runs inside WSL, started by the Windows app: the bundled Linux backend on
# port $1, with the login shell's IRAF environment (iraf, PATH to irafcl).
# $2 is the Windows profile (C:\Users\...): the user's files and GIRAF data
# live there (/mnt/c/...), as on the other platforms.
here=$(cd "$(dirname "$0")" && pwd)
GIRAF_HOME=$(wslpath -u "$2" 2>/dev/null || echo "$HOME")
export GIRAF_PORT="$1" GIRAF_HOME GIRAF_DATA="${GIRAF_DATA:-$GIRAF_HOME/Documents/GIRAF}"
export PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
mkdir -p "$GIRAF_DATA"
# exec keeps this pid through the shell and Python, so the app can stop it.
echo $$ > "$HOME/.giraf/backend.pid"
exec "${SHELL:-/bin/sh}" -ilc 'cd "$0/backend" && exec ../python/bin/python3 main.py' "$here"
