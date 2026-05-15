# auto-classify (Python sidecar)

Stage 1 of automatic section classification, for the CLI import path
(`bin/import-from-device.ts`). The web client has its own TypeScript
implementation under `src/client/lib/auto-classify/` that produces the
same output shape — see `~/projects/plans/2026-05-15-paperstem-auto-section-classification-design.md`
for the "two runtimes, one contract" rationale.

## What it does

Takes an audio file path, runs YAMNet via TFLite (`ai-edge-litert`),
smooths the per-window class predictions, extracts chroma fingerprints for
each detected music segment, and emits a JSON object on stdout.

Output shape (matches `ClassifiedSegment[]` from `src/shared/types.ts`):

```json
{
  "segments": [
    {
      "start_ms": 0,
      "end_ms": 15600,
      "segment_type": "music",
      "top_classes": [{"name": "Music", "score": 0.83}, ...],
      "chroma": [[0.1, 0.2, ...12 floats], ...]
    }
  ],
  "audio_hash": "sha256-hex...",
  "duration_ms": 312000
}
```

`chroma` is present only on `music`-typed segments.

## Setup

```bash
bash bin/auto-classify/setup.sh
```

This creates a `uv`-managed `.venv` next to the script, installs the pinned
dependencies (`ai-edge-litert`, `numpy`, `soundfile`, `resampy`, `librosa`),
and downloads `yamnet.tflite` from Google's mediapipe-models bucket.

Requires [`uv`](https://docs.astral.sh/uv/). On macOS:

```bash
brew install uv
```

## Usage

```bash
bin/auto-classify/.venv/bin/python bin/auto-classify/classify.py /path/to/audio.wav > result.json
```

The CLI (`bin/import-from-device.ts`, Phase 6) invokes this as a child
process after each project's audio finishes uploading, reads the JSON, and
POSTs it to `/api/projects/:id/classify` with `source_surface='cli'`.

## Testing

```bash
.venv/bin/python -m pytest tests/
```

The smoke test builds a tiny synthesized WAV in `tmp/`, runs `classify.py`
against it, and asserts the JSON has the expected shape.

## Keeping in sync with the browser implementation

The output JSON must match `ClassifiedSegment[]` from `src/shared/types.ts`.
The class-mapping rules in `audioset_mapping.py` mirror
`src/client/lib/auto-classify/audioset-mapping.ts` by hand; if you change one,
change the other.

## Files

| File | Purpose |
|---|---|
| `classify.py` | Entry point. `python classify.py <audio>` → JSON on stdout. |
| `audioset_mapping.py` | AudioSet → Paperstem SegmentType (Python mirror of the TS module). |
| `chroma.py` | Chroma extraction via librosa, frame-rate (matches browser). |
| `requirements.txt` | Pinned deps. |
| `yamnet_class_map.csv` | 521-row AudioSet label list (checked in). |
| `yamnet.tflite` | YAMNet model (~4 MB, fetched by setup.sh, gitignored). |
| `.venv/` | Python venv (gitignored). |
| `setup.sh` | One-time setup. Idempotent. |
| `tests/test_classify.py` | Pytest smoke test on a synthesized WAV. |
