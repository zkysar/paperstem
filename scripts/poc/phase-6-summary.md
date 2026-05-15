# Phase 6 Summary — Tascam Model 12 CLI integration

## (a) What got built

The CLI import path (`bin/import-from-device.ts`) now runs the Python
auto-classification sidecar after each project's audio uploads and POSTs the
result to `POST /api/projects/:id/classify` with `source_surface: 'cli'`.

Files touched:

| File | Purpose |
|---|---|
| `bin/auto-classify-runner.ts` (new) | Thin Node wrapper around the Python sidecar. Exposes `runSidecar(audioPath, paths, execFileSyncFn)` returning a discriminated `SidecarOutcome` (`{ ok, result }` or `{ ok: false, failure }`), `sidecarVenvExists(paths)` for the startup check, and `sidecarSetupHint` for friendly error text. Buffers stdout to 50 MB. |
| `bin/import-from-device.ts` (modified) | Added `--auto-classify` boolean flag (default `true`). After each upload completes (before the per-task tmp dir is removed), calls `classifyProject(...)` which invokes the sidecar on the first encoded mp3 and POSTs the JSON wire body (segments + audio_hash + duration_ms + classifier_version='yamnet-v1' + fingerprint_version=1 + source_surface='cli'). Prints `Classified <project>: N sections proposed (M named)` on success. All failure modes (missing venv, sidecar non-zero exit, non-2xx response, network/JSON errors) log a hint and continue — the import is never aborted by classification problems. `main()` does a one-shot existence check on `bin/auto-classify/.venv/bin/python` at startup; if the venv is missing it prints the setup hint and disables the flag for the run. |
| `bin/import-from-device.test.ts` (modified) | Three new tests: (1) sidecar invoked + classify POST happens when `autoClassify: true` and venv exists, (2) graceful skip when venv missing (no sidecar call, no classify POST, hint printed), (3) no sidecar invocation when `autoClassify: false`. Mocks `execFileSync` and `fetch`. |

Plumbing: `RunOpts` gained `autoClassify?: boolean`, `execFileSyncFn?: ExecFileSyncFn`, `runnerPaths?: RunnerPaths`. These thread into `runImporterInner` which calls the new `classifyProject()` helper at the right moment in the per-task loop.

Audio path choice: the Tascam Model 12 doesn't have a single "mixed" recording — it produces one WAV per track. The implementation classifies on the **first encoded mp3** (in tmp, already segment-sliced if the source had cue points), since YAMNet on any source from a band practice classifies the scene equally well and the tmp file is naturally available right before `rmSync`. Documented inline.

Test count: `bin/import-from-device.test.ts` goes from 4 to 7 tests. Full suite: **904 tests passing** (up from 901).

## (b) Commits

```
<filled in by commit>
```

All commits include `Co-Authored-By: Claude Opus 4.7 (1M context)` trailer. Nothing pushed to remote; no PR opened.

## (c) Deviations from the plan

1. **Tfjs-node vs Python sidecar.** The plan as written still references `runStage1Node` from `src/shared/auto-classify/classify.js` and a `tfjs-node` startup-existence check. The Phase 2 POST-POC revision and the brief override both of these — the CLI runtime is the Python sidecar at `bin/auto-classify/`. Implementation follows the brief: existence check is on `bin/auto-classify/.venv/bin/python`; invocation is `execFileSync(pythonBin, [classifyScript, audioPath])`; the install hint points at `bash bin/auto-classify/setup.sh`.

2. **Helper file factored out.** The brief authorized a small `bin/auto-classify-runner.ts` if useful. I factored it out because (a) it keeps `import-from-device.ts` from sprouting child-process boilerplate inline, and (b) the same helper will be the obvious reuse target for Phase 4's backfill script. Surface is small (`runSidecar`, `sidecarVenvExists`, `sidecarSetupHint`, `pythonBinPath`, `classifyScriptPath`, three types) and free of side effects at import time.

3. **Audio path is the first encoded mp3, not a "mixed" file.** The plan and brief both mention "the final mixed audio path for that project from local cache," but the Tascam Model 12 importer does not produce one — its outputs are per-track mp3s in a tmp directory. Using `encodedForClassify[0]` (the first track) is the closest equivalent and matches what's available before tmp cleanup. Inline comment in the code.

4. **Auto-classify is a CLI flag, not a config-file field.** The `Config` type in `bin/import-from-device.ts` was not extended; the flag is purely command-line. This matches the brief's wording ("`--auto-classify` and `--no-auto-classify` flags exist on the CLI") and keeps existing config files unchanged.

5. **The summary line counts label-bearing sections as "named."** A section is counted as named if it has either a `song_id` or a `label` (e.g. `Music`, `Chatter`, `Tuning`, `Count-in`). This matches the brief's definition. Phase 3's response shape sets `label` for non-music typed sections, so a project with 4 typed sections and 2 song matches reports e.g. `6 sections proposed (6 named)`.

## (d) What Phase 7 should know

- **The CLI is end-to-end testable but requires the sidecar venv.** Run `bash bin/auto-classify/setup.sh` once on the host machine, then a normal `paperstem-import` invocation will classify each freshly-imported project and you'll see `Classified <name>: N sections proposed (M named)` lines interleaved with the upload progress.

- **No smoke-test artifact is committed.** End-to-end smoke requires either real Tascam Model 12 SD-card recordings or a synthesized multi-track fixture, plus a Paperstem server reachable at the configured URL. The unit tests cover the contract (sidecar invocation + POST body + failure handling); a true smoke test belongs in Phase 7's evaluation pass against real practice recordings.

- **Idempotency works automatically.** The classify endpoint's `(project_id, audio_hash, classifier_version, fingerprint_version)` idempotency means re-running the importer on the same SD card after the marker has been promoted will not re-classify — the importer skips already-`done` segments. If a project does get re-classified (e.g. resumed in-progress), the server returns `reused=true` and the CLI logs the same summary line, harmlessly.

- **Network errors don't abort the import.** All classification failure paths log via `console.warn` and return; the marker has already been written by that point so the segment is recorded as uploaded regardless of whether classification succeeded. This matches the brief's "the CLI's primary job is the upload; classification is a bonus."

- **The `bin/import-from-device.ts` file header was updated** to document the two new flags (`--auto-classify` / `--no-auto-classify`) alongside `--config`.

- **No changes to `src/client/`, `src/server/`, or `bin/auto-classify/`** were made by this phase. Scope was kept strict per the brief, even though `src/shared/auto-classify/classify.js` (referenced by the original plan text) doesn't exist on this branch — Phase 2 revised away from that module in favor of the Python sidecar.
