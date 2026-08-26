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
zip -q "$out" __init__.py config.json config.md
cd ..
echo "built $(pwd)/anki_supabase_sync.ankiaddon"
