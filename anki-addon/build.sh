#!/bin/sh
# Package the add-on as anki_supabase_sync.ankiaddon, which Anki installs via
# Tools → Add-ons → Install Add-on From File (handy for the Windows laptop,
# where copying into %APPDATA%\Anki2\addons21 by hand is fiddlier).
#
# The zip holds the FILES, not the folder — Anki expects __init__.py at the
# archive root — plus a manifest.json, which installing from a file requires
# ("package" and "name" are mandatory; see aqt/addons.py _manifest_schema).
# "package" becomes the installed folder name, so it must match the source
# folder. Staged in a temp dir so the manifest never lands in the source tree,
# and so __pycache__ and the GUI-written meta.json stay out: both per-machine.
set -e

cd "$(dirname "$0")"
out="$PWD/anki_supabase_sync.ankiaddon"
rm -f "$out"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp anki_supabase_sync/__init__.py anki_supabase_sync/config.json \
   anki_supabase_sync/config.md "$tmp/"
cat > "$tmp/manifest.json" <<'JSON'
{
  "package": "anki_supabase_sync",
  "name": "Écoute — Anki time sync"
}
JSON

cd "$tmp"
files="manifest.json __init__.py config.json config.md"
# Git Bash on Windows ships no `zip`, so fall back to Python's zipfile, which
# writes an identical archive and comes with any Python install.
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
  echo "  (then add a manifest.json with \"package\" and \"name\" — Anki requires it)" >&2
  exit 1
fi

echo "built $out"
