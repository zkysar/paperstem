# Auto-Section Classification POC

Isolated R&D for the speculative auto-section-classification feature. Not part
of the main Paperstem app build. The POC validates whether YAMNet (audio scene
classification) + chroma + DTW (acoustic song matching) is accurate enough on
real band practice audio to be worth productionizing.

**Design and plan:**
- `~/projects/plans/2026-05-15-paperstem-auto-section-classification-design.md`
- `~/projects/plans/2026-05-15-paperstem-auto-section-classification-plan.md`

## Setup

This directory has its own `package.json` + `node_modules` (for the chroma
spike) and its own Python `.venv` (for the YAMNet spike), isolated from
Paperstem's. Installing here does not rebuild Paperstem's native modules.

```bash
cd scripts/poc
npm install                      # for the Node/TS chroma spike

uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python ai-edge-litert numpy soundfile resampy
```

The YAMNet tflite model is downloaded into this directory (gitignored):

```bash
curl -L -o yamnet.tflite \
  https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/latest/yamnet.tflite
```

ffmpeg is required on the PATH for audio decoding.

## Why Python for YAMNet (and why that's the spike, not the production runtime)

The plan originally assumed `@tensorflow-models/yamnet` exists on npm and
runs in Node. It does not — see `findings-runtime-gap.md` for the full
story. `@mediapipe/tasks-audio` ships as a browser-only bundle (it pokes at
`document` and DOM `addEventListener` at module init).

The Python POC unblocks the actual research question ("does YAMNet correctly
classify band practice audio?") without committing to a runtime. If the
approach validates, we'll pick a Node/browser path (ONNX, Python sidecar,
custom TFLite→tfjs port) as a separate design issue.

## Spikes

### `spike-yamnet.py`

Runs YAMNet on a ground-truth-labeled practice recording and prints the
inferred per-window class probabilities. Pass criteria: ≥70% of segment
boundaries within 5 seconds of a ground-truth boundary, ≥70% of segment types
correctly classified.

```bash
.venv/bin/python spike-yamnet.py /path/to/practice.wav
# or
npm run spike:yamnet -- /path/to/practice.wav
```

Ground-truth file format: `ground-truth.json` (next to this README), an array
of `{ start_ms, end_ms, type, song_name }` segments. See
`ground-truth.example.json` for the expected shape.

### `spike-chroma.ts`

Compares DTW distances between three hand-trimmed clips: two renditions of
the same song from different practices, plus one rendition of a different
song. Pass criteria: same-song DTW distance is meaningfully smaller (≥2×
ratio) than cross-song DTW distance.

```bash
npm run spike:chroma -- /path/same-a.wav /path/same-b.wav /path/diff.wav
```

## Findings

Each spike produces a `spike-*-findings.md` next to it, summarizing the
result and any deviations from the assumed design. These feed the
decision-gate at the end of Phase 0 in the plan.
