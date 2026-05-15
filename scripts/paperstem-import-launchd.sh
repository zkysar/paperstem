#!/usr/bin/env bash
# Launchd wrapper for the Model 12 / multitrack device importer.
#
# Pulls PAPERSTEM_SESSION_TOKEN from macOS Keychain (synced from Keeper by
# `dots keys`) and runs the importer. The token never lives on disk in plain
# text, so the launchd plist itself stays free of secrets.
#
# Scheduled by ~/Library/LaunchAgents/com.zachkysar.paperstem-import.plist,
# which is tracked in the dotfiles repo (see manifest.toml).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if ! TOKEN="$(security find-generic-password -a "$USER" -s PAPERSTEM_SESSION_TOKEN -w 2>/dev/null)"; then
  echo "paperstem-import: PAPERSTEM_SESSION_TOKEN not in Keychain." >&2
  echo "  add it with: dots keys add PAPERSTEM_SESSION_TOKEN" >&2
  exit 1
fi
export PAPERSTEM_SESSION_TOKEN="$TOKEN"

# Launchd's PATH is minimal; we need ffmpeg from Homebrew.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin"

exec ./node_modules/.bin/tsx bin/import-from-device.ts "$@"
