#!/usr/bin/env bash
# One-time setup for the auto-classify Python sidecar.
#
# Creates a uv-managed .venv next to this script, installs the pinned
# dependencies in requirements.txt, and fetches yamnet.tflite from
# Google's mediapipe-models bucket. Idempotent — safe to re-run.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is not installed. Install it from https://docs.astral.sh/uv/ and re-run." >&2
  exit 1
fi

if [[ ! -d .venv ]]; then
  echo "Creating Python venv with uv..."
  uv venv .venv
fi

echo "Installing dependencies from requirements.txt..."
uv pip install --python .venv/bin/python -r requirements.txt

if [[ ! -f yamnet.tflite ]]; then
  echo "Fetching yamnet.tflite..."
  curl -L -o yamnet.tflite \
    https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/latest/yamnet.tflite
else
  echo "yamnet.tflite already present, skipping download."
fi

echo "Setup complete. Try: .venv/bin/python classify.py <audio-file>"
