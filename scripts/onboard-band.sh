#!/usr/bin/env bash
set -euo pipefail
export GMAIL_USER="${GMAIL_USER:-zach.kysar@gmail.com}"
export GMAIL_APP_PASSWORD="${GMAIL_APP_PASSWORD:-$(security find-generic-password -a "$USER" -s PAPER_STEM_APP_CODE -w | tr -d ' ')}"
export APP_URL="${APP_URL:-http://localhost:5173}"
export DATABASE_PATH="${DATABASE_PATH:-./dev.sqlite}"
exec npx tsx bin/onboard-band.ts "$@"
