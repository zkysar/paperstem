#!/usr/bin/env bash
set -euo pipefail
exec "$(dirname "$0")/with-secrets.sh" npx tsx bin/seed-practice.ts "$@"
