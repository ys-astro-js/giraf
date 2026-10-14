#!/bin/sh
# Runs inside WSL, started by the Windows app: the bundled Linux backend on
# port $1, with the login shell's IRAF environment (iraf, PATH to irafcl).
# $2 is the Windows profile (C:\Users\...): the user's files and default work
# folder live there (/mnt/c/...), as on the other platforms. Runs and app
# state stay on the Linux disk: IRAF reading and writing through /mnt/c is
# many times slower.
here=$(cd "$(dirname "$0")" && pwd)
GIRAF_HOME=$(wslpath -u "$2" 2>/dev/null || echo "$HOME")
export GIRAF_PORT="$1" GIRAF_HOME GIRAF_FOLDER="${GIRAF_FOLDER:-$GIRAF_HOME/Documents/GIRAF}"
export GIRAF_DATA="${GIRAF_DATA:-$HOME/.giraf/data}"
export PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
mkdir -p "$GIRAF_DATA" "$GIRAF_FOLDER"
# Earlier versions kept app state in the work folder; bring it over once.
# Old runs stay there.
for name in .workspace.json user-schemas; do
  [ -e "$GIRAF_DATA/$name" ] || [ ! -e "$GIRAF_FOLDER/$name" ] || cp -R "$GIRAF_FOLDER/$name" "$GIRAF_DATA/$name"
done
# exec keeps this pid through the shell and Python, so the app can stop it.
echo $$ > "$HOME/.giraf/backend.pid"
exec "${SHELL:-/bin/sh}" -ilc 'cd "$0/backend" && exec ../python/bin/python3 main.py' "$here"
