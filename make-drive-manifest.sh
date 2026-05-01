#!/usr/bin/env bash
# Regenerate drive-manifest.json from a public Google Drive folder.
#
# Usage:
#   ./make-drive-manifest.sh                  # uses the default folder ID below
#   ./make-drive-manifest.sh <FOLDER_ID>      # any other public folder
#
# How it works: Drive serves a server-rendered HTML listing for public folders
# at https://drive.google.com/embeddedfolderview?id=<id>#list . We curl that
# page and extract (file_id, filename) pairs from the flip-entry markup. The
# manifest is then written next to this script as drive-manifest.json.

set -euo pipefail

DEFAULT_ID="18waywWp-_rjh4ZOvykMeAFIl4SOJ2yfV"
FOLDER_ID="${1:-$DEFAULT_ID}"
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HTML_TMP="$(mktemp -t drive-list.XXXXXX.html)"
trap 'rm -f "$HTML_TMP"' EXIT

curl -fsSL "https://drive.google.com/embeddedfolderview?id=${FOLDER_ID}#list" -o "$HTML_TMP"

python3 - "$FOLDER_ID" "$HTML_TMP" "$HERE/drive-manifest.json" <<'PY'
import sys, re, json, html
from pathlib import Path

folder_id, html_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
src = Path(html_path).read_text()

pattern = re.compile(
    r'class="flip-entry"\s+id="entry-(?P<id>[A-Za-z0-9_-]+)".*?'
    r'class="flip-entry-title"[^>]*>(?P<name>[^<]+)<',
    re.S,
)
audio_re = re.compile(r'\.(mp3|wav|ogg|oga|flac|m4a|aac|webm|opus)$', re.I)

entries, seen = [], set()
for m in pattern.finditer(src):
    fid = m.group('id')
    if fid in seen:
        continue
    seen.add(fid)
    name = html.unescape(m.group('name')).strip()
    if not audio_re.search(name):
        continue
    entries.append({
        'name': name,
        'id': fid,
        'url': f'https://drive.google.com/uc?export=download&id={fid}',
    })

manifest = {
    'source': f'https://drive.google.com/drive/folders/{folder_id}',
    'note': ('Generated from embeddedfolderview HTML. Streaming via '
             'uc?export=download is unreliable for files larger than ~50MB '
             '(Drive injects a virus-scan interstitial). For reliable '
             'playback, download the folder locally and use Load folder.'),
    'count': len(entries),
    'stems': entries,
}
Path(out_path).write_text(json.dumps(manifest, indent=2) + '\n')
print(f'wrote {out_path} with {len(entries)} entries')
PY
