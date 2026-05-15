# Phase 4 Summary — Fingerprint corpus building

## (a) What got built

| File | Purpose |
|---|---|
| `src/server/auto-classify/fingerprint-route.ts` | New endpoint `POST /api/projects/:id/sections/:sectionId/fingerprint`. Accepts a chroma blob from the client, packs it via the existing `chroma-blob.ts` layout, inserts into `song_fingerprints`. Idempotent on `section_id` (delete-then-insert in a transaction). |
| `src/server/auto-classify/fingerprint-route.test.ts` | 7 vitest cases covering happy-path, idempotency, 400 on section-without-song, cross-project section reference, auth/membership, and input validation. |
| `src/server/index.ts` | Mount the new route under `POST /api/projects/:id/sections/:sectionId/fingerprint`. |
| `src/server/storage.ts` | New `resolveFileIdToPath(fileId)` helper that returns the absolute on-disk path of a stem file. Throws `StorageNotFoundError` when missing. Read-only, intended for out-of-band tooling (the backfill script). |
| `src/server/storage.test.ts` | 3 additional vitest cases for the new helper. |
| `bin/backfill-fingerprints.ts` | One-shot CLI that walks every section with a song_id that doesn't yet have a fingerprint, runs the Phase 2 Python sidecar against the project's primary stem audio, slices the resulting chroma to the section's `[start_ms, end_ms]` window, and inserts via `repository.insertFingerprint`. |
| `bin/backfill-fingerprints.test.ts` | 5 vitest cases covering the pure `sliceChromaForSection` slicer (overlap selection, proportional slicing, empty/inverted ranges). |

Test counts:
- Fingerprint route: 7
- Storage helper: 3 (added on top of 31)
- Backfill slicer: 5

Full vitest suite at **909 tests** (up from Phase 3's 891).

## (b) Commits

```
73b8118 feat(auto-classify): backfill script for existing sections
339719a feat(storage): resolveFileIdToPath helper
b8314ce feat(auto-classify): POST section fingerprint endpoint
```

All commits include the `Co-Authored-By: Claude Opus 4.7 (1M context)` trailer. Nothing was pushed to the remote and no PR was opened, per the task brief.

## (c) Deviations from the plan and why

The plan (`~/projects/plans/2026-05-15-paperstem-auto-section-classification-plan.md` § Phase 4) was written before the runtime split was locked in by Phase 2's POC. It assumed:

1. Server-side chroma extraction (`buildAndStoreFingerprint` decoding the audio in Node via `src/shared/auto-classify/runtime-node.ts`, then calling `extractChromaSequence` in-process).
2. A fingerprint build automatically triggered from inside `src/server/sections.ts` whenever a section gained a `song_id`, via `setImmediate`.

Neither is viable now: chroma extraction lives in `meyda` (browser) and `librosa` (Python sidecar). The server's Node process has neither. So this phase deviates as follows:

1. **Chroma comes from the client, not the server.** The new endpoint accepts a chroma blob in the request body — the same `number[][]` shape already carried on `ClassifiedSegment.chroma` during draft-mode classification. The server is a thin pack-and-insert: no audio decoding, no DSP. This keeps the server's runtime footprint identical to Phase 3 and keeps a clean cut at the runtime boundary (browser owns DSP; server owns identity).
2. **No `setImmediate` hook in `sections.ts`.** The trigger for fingerprinting is the client deciding to send the blob, not the server detecting a `song_id` change. This means a manual section created server-side (e.g. via the CLI flow that doesn't ship chroma) won't auto-fingerprint — that's the backfill script's job.
3. **The backfill script uses the Python sidecar.** Rather than calling `buildAndStoreFingerprint` (which would require a Node decoder), it shells out to `bin/auto-classify/.venv/bin/python bin/auto-classify/classify.py <audio>` — the same path Phase 6's CLI will use — and slices the resulting chroma to each section's range. Same wire format the route consumes, so there's no second packer to keep in sync.
4. **`CURRENT_FINGERPRINT_VERSION` lives in the backfill script** (`bin/backfill-fingerprints.ts`), not in a shared `fingerprint-builder.ts`. The route doesn't need it — the client passes `fingerprint_version` in the request body, and that's the canonical value for the corpus key. The backfill is the only consumer; co-locating the constant with its sole user keeps the dependency graph flat. If a future Phase 5 client wants to assert the same constant, it can import from `bin/backfill-fingerprints.ts` or move the constant to `src/shared/auto-classify/` at that time.
5. **Added a tiny `resolveFileIdToPath` storage helper.** The plan's Task 4.2 hand-waved at "the existing storage module already exposes a 'main mix' path." It doesn't — `storage.ts` is all stream/blob APIs. Adding a focused read-only path resolver was cleaner than punching `pathFromRel` out as exported or duplicating the path math in the backfill. Tested independently and only used by the backfill.

## (d) What Phase 5 needs to call

Phase 5 (web client) populates the corpus by POSTing chroma whenever the user accepts or renames an auto-section into a song reference, or creates a manual section with a song reference, after a classification run has produced chroma in memory.

### Endpoint

```
POST /api/projects/:id/sections/:sectionId/fingerprint
```

Authn: same as the rest of `/api/projects/:id/*` — session cookie required; user must be a member of the project's band.

### Request body

```ts
{
  chroma: number[][],            // beat-rate chroma frames; each row exactly 12 floats
  fingerprint_version: number,   // integer ≥ 1; bumps when extraction algo changes
  duration_ms: number,           // integer ≥ 0; the section's time span in ms
}
```

The `chroma` shape is identical to `ClassifiedSegment.chroma` (which Phase 5 already has in memory from the draft-mode `runStage1Browser` call), so the client can forward it without re-encoding. Pull the matching segment's chroma out of the in-memory classification result and slice it to the section's range — the server applies no further transformation.

### Response

```ts
{ id: string }   // the song_fingerprints row id (uuid)
```

Status codes:
- `200` — fingerprint inserted (or replaced an existing one for this section)
- `400 invalid_json` / `400 invalid_input` — malformed body
- `400 section_must_reference_a_song` — section has no `song_id`; the client should rename / select a song first
- `401` — no session
- `404` — project not found, section not found, section not in the named project, or user is not a band member

### Idempotency

Re-POSTing for the same `section_id` deletes the prior row and inserts a fresh one in a single transaction. The returned `id` will be a new uuid, but at most one fingerprint per section ever exists. So the client is free to fire-and-forget on every save without dedup logic.

### When NOT to call

- The section has no chroma in scope. This is the case for sections created before any classification run. Phase 5 should leave those alone; the `bin/backfill-fingerprints.ts` script handles them out-of-band.
- The section is a free-text label (`section.label` set, `song_id` null). Endpoint returns 400.

## Anything worth flagging

- The backfill script's `resolveFileIdToPath` will print "stem audio missing on disk" rather than crash when a stem row exists but its file is missing (orphan/imported state). That's intentional — the backfill is best-effort, not migration-critical.
- The `bin/auto-classify/.venv` is gitignored. A fresh checkout that wants to run the backfill must run `bin/auto-classify/setup.sh` first. The script prints a clear hint if the venv is missing.
- The route does NOT verify the chroma's `fingerprint_version` matches anything server-side. That's deliberate — the client is the source of truth for which algorithm produced the blob; the server only persists the tuple. The matcher's idempotency key (`fingerprint_version` in `classification_runs`) is what gates "re-run with new algo".
