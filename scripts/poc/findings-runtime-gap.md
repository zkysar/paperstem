# Finding: Node Runtime Gap for YAMNet (2026-05-15)

The original plan (Phase 2.4 — "YAMNet inference wrapper") assumed
`@tensorflow-models/yamnet` existed on npm with a Node-friendly API. It
does not. `@mediapipe/tasks-audio` (Google's official audio task package)
exists but ships as a browser-only bundle — `audio_bundle.mjs` references
`document` and DOM `addEventListener` at module init, so it cannot run in
Node without a substantial browser-emulation layer.

**Impact on the design:**
- The "shared runtime" goal (same TS module runs in browser + Node via
  `tfjs` vs `tfjs-node` adapters) needs to be revisited. There is no
  off-the-shelf TF.js YAMNet build that works in both environments today.
- The Tascam CLI surface (Phase 6 in the plan) needs a different runtime
  for Stage 1. Options to investigate AFTER the approach is validated:
  - **ONNX runtime path** — convert YAMNet to ONNX, use `onnxruntime-node`
    in the CLI and `onnxruntime-web` in the browser. A YAMNet ONNX export
    exists on Hugging Face (community).
  - **Python sidecar** — CLI shells out to `python spike-yamnet.py` for
    Stage 1. Simplest if Python is a tolerable dep for CLI users.
  - **Headless browser** — drive MediaPipe in a Playwright/Puppeteer
    instance. Heavy.
  - **Custom TFLite → tfjs port** — port the 3.9MB tflite to tfjs format
    using the published conversion tool. Most aligned with the original
    plan but unverified.

**POC pivot:**
The Phase 0 spike runs YAMNet in Python via `ai-edge-litert` (the slim
TFLite runtime). This unblocks the actual research question — does
audio scene classification work on real practice audio? — without
committing to a deployment runtime. See `spike-yamnet.py`.

**Chroma side is unaffected.** `meyda` works in Node out of the box; the
chroma spike still runs there.
