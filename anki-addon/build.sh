#!/bin/sh
# Package the add-on as anki_supabase_sync.ankiaddon, which Anki installs via
# Tools → Add-ons → Install Add-on From File (handy for the Windows laptop,
# where copying into %APPDATA%\Anki2\addons21 by hand is fiddlier).
#
# Anki names the installed folder after the file, so keep the .ankiaddon name
# matching the source folder. The zip holds the FILES, not the folder — Anki
# expects __init__.py at the archive root. __pycache__ and the GUI-written
# meta.json are left out on purpose: they're per-machine.
set -e

cd "$(dirname "$0")/anki_supabase_sync"
out="../anki_supabase_sync.ankiaddon"
rm -f "$out"
# Git Bash on Windows ships no `zip`, so fall back to Python's zipfile, which
# writes an identical archive and comes with any Python install.
files="__init__.py config.json config.md"
if command -v zip >/dev/null 2>&1; then
  zip -q "$out" $files
elif py=$(command -v python3 || command -v python); then
  "$py" -c "import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sys.argv[2:]:
        z.write(f)" "$out" $files
else
  echo "build.sh needs either 'zip' or python on PATH." >&2
  echo "On Windows without either, run this in PowerShell from anki-addon/:" >&2
  echo "  Compress-Archive -Path anki_supabase_sync\\* -DestinationPath anki_supabase_sync.zip" >&2
  echo "  Rename-Item anki_supabase_sync.zip anki_supabase_sync.ankiaddon" >&2
  exit 1
fi
cd ..
echo "built $(pwd)/anki_supabase_sync.ankiaddon"
