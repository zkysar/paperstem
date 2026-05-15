# Phase 2 summary — Stage 1 implementations

Phase 2 productionizes the two Stage 1 paths the design calls for: a
TypeScript module set for the browser ("Auto-section this practice"
button, Phase 5) and a Python sidecar for the CLI importer (Phase 6).
Both produce the same `ClassifiedSegment[]` JSON shape (see
`src/shared/types.ts`) so the server matcher in Phase 3 is identical
across surfaces.

## What got built

### Browser (TypeScript, under `src/client/lib/auto-classify/`)

| File | Role |
|---|---|
| `audioset-mapping.ts` | Map a YAMNet window's top-K AudioSet predictions to a Paperstem `SegmentType` (`music` / `chatter` / …). Mirrors `bin/auto-classify/audioset_mapping.py`. |
| `smooth.ts` | 5-window median filter + contiguous-class merge + short-segment absorption → `ClassifiedSegment[]`. |
| `chroma.ts` | Frame-rate 12-D chroma via `meyda` + `packChroma` / `unpackChroma` blob helpers (little-endian float32). |
| `mediapipe-yamnet.ts` | Wraps `@mediapipe/tasks-audio`'s `AudioClassifier`. Loads `/yamnet.tflite` (self-hosted) and MediaPipe's wasm bundle. |
| `classify.ts` | Orchestrator: `runStage1(blob, { onProgress })` decodes via `OfflineAudioContext`, runs YAMNet, smooths, extracts chroma per music segment. Returns `{ segments, audio_hash, duration_ms }`. |

Co-located `.test.ts` files for each non-trivial pure module: 23 new client
tests, all passing. `mediapipe-yamnet.ts` and `classify.ts` are exercised
end-to-end by the manual smoke in Phase 5 (Task 5.7).

`public/yamnet.tflite` (~3.9 MB) is committed so the model ships in the
build artifact rather than being fetched from a third-party CDN.

### CLI (Python, under `bin/auto-classify/`)

| File | Role |
|---|---|
| `classify.py` | Entry point. `python classify.py <audio>` → JSON on stdout. |
| `audioset_mapping.py` | Mirror of the TS module. |
| `chroma.py` | `librosa.feature.chroma_stft`, same frame size/hop/sample rate as the browser. |
| `requirements.txt` | Pinned: `ai-edge-litert==1.4.0`, `numpy==2.2.6`, `soundfile==0.13.1`, `resampy==0.4.3`, `librosa==0.11.0`. |
| `yamnet_class_map.csv` | 521-row AudioSet label list (checked in). |
| `setup.sh` | One-time setup: `uv venv .venv && uv pip install … && curl yamnet.tflite`. Idempotent. |
| `tests/test_classify.py` | Pytest smoke test on a synthesized WAV; skipped if `yamnet.tflite` is missing. |
| `README.md` | Install + invocation reference. |
| `.gitignore` | `.venv/`, `yamnet.tflite`, `__pycache__/`. |

## Commits landed in this phase

```
af8b7f1 feat(auto-classify): Python sidecar for CLI Stage 1
53ff1bd feat(auto-classify): browser Stage 1 orchestrator
b20f9d2 feat(auto-classify): MediaPipe AudioClassifier wrapper + bundled YAMNet model
8d3c2ad feat(auto-classify): chroma extraction + blob pack/unpack
06d0bcb feat(auto-classify): class smoothing + segment derivation
d1c7654 feat(auto-classify): AudioSet → Paperstem class mapping
```

## Verification status

- `npx tsc --noEmit` — clean.
- `npx vitest run --project client` — 520 passed (51 files), up from 497.
- `npx vitest run --project server` — pre-existing native-binding breakage
  (better-sqlite3 lost its `.node` file during the dependency install).
  Phase 2 doesn't touch the server. See `scripts/poc/phase-2-blockers.md`
  for the recovery path (one `npm rebuild better-sqlite3` from a normal
  shell).
- `bin/auto-classify/setup.sh` and the real-audio smoke against
  `scripts/poc/audio/practice-mix.wav` — could not run from inside the
  agent sandbox (every `python` / `uv` / `bash setup.sh` invocation is
  denied). See blockers doc.

## Deviations from the plan

1. **Directory layout.** The plan's revised Phase 2 puts TS files under
   `src/shared/auto-classify/`. Per the task instructions, I put them
   under `src/client/lib/auto-classify/` (browser-only consumers; nothing
   server-side imports them in Phase 2 or Phase 3). This also means the
   tests run only under the `client` vitest project (happy-dom).
2. **`OfflineAudioContext`-based decode** in `classify.ts` rather than
   the plan's loose "decode audio via OfflineAudioContext". Concrete
   implementation matches plan intent.
3. **MediaPipe wasm load path.** `mediapipe-yamnet.ts` currently loads
   wasm from `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio/wasm`.
   The design says self-host. I left the constant `WASM_BASE_PATH`
   centralised; Phase 5 should wire a build step that copies
   `node_modules/@mediapipe/tasks-audio/wasm/*` into
   `public/mediapipe/tasks-audio/wasm/` and flip the constant. Putting
   this in Phase 5 (where the browser path is first actually used) keeps
   the build-config change tied to the surface that needs it.
4. **`@tensorflow-models/yamnet` and `@tensorflow/tfjs-node` deps from
   the original plan** are *not* installed. The plan's POST-POC Phase 2
   revision (lines 565–614 of the plan doc) explicitly drops them in
   favour of `@mediapipe/tasks-audio` (browser) and `ai-edge-litert`
   (Python sidecar). I followed the revision.
5. **No `phase-2-smoke.json`.** Sandbox blocked Python execution. See
   `phase-2-blockers.md` for the unblock command.

## What Phase 3 should know before consuming this work

- **Wire format the server should expect on `POST /api/projects/:id/classify`:**
  ```ts
  {
    segments: ClassifiedSegment[],   // see src/shared/types.ts
    audio_hash: string,              // sha256 hex of the audio bytes
    duration_ms: number,
    classifier_version: 'yamnet-v1', // CLASSIFIER_VERSION constant
  }
  ```
  Browser produces `chroma` as `number[][]` directly on the segment.
  Python sidecar emits the same shape (matching JSON arrays). The server
  shouldn't need to base64-decode anything; the wire format is already
  JSON-native float arrays.

- **Frame-rate, not beat-synchronous chroma.** Both implementations chose
  frame-rate so DTW handles tempo differences across renditions. If the
  matcher's accuracy ever needs beat-sync, the change is localised: swap
  `extractChromaSequence` in `chroma.ts` and `chroma.py`. The blob format
  (`packChroma`/`unpackChroma`) doesn't care about the source rate.

- **`packChroma` / `unpackChroma`** in `chroma.ts` produce/consume a
  little-endian float32 `Uint8Array` (browser side). Server code should
  convert to a Node `Buffer` at the DB write boundary; the byte layout
  is identical. For audio coming from the Python sidecar, the chroma is
  emitted as `number[][]` JSON, so the server packs it itself before
  storage.

- **`segment_type` taxonomy:** `music | chatter | tuning | silence | count_in | unknown`
  (matches `SegmentType` in `src/shared/types.ts`). `count_in` is not yet
  produced by Stage 1 — the plan defers `count_in` heuristics until after
  v1 measures whether YAMNet's raw output is enough.

- **CLASSIFIER_VERSION** is the string `'yamnet-v1'` exported from
  `src/client/lib/auto-classify/mediapipe-yamnet.ts`. The server should
  store this on `classification_runs.classifier_version` for forward
  compatibility.

- **The shared module convention is "two implementations, one contract."**
  The TS module under `src/client/lib/auto-classify/` and the Python under
  `bin/auto-classify/` are kept in sync by hand. If you touch the
  AudioSet rules, smoothing parameters, or chroma frame/hop sizes,
  change both.
