# Phase 3 Summary — Server: DTW matcher, naming rules, and API

## (a) What got built

All under `src/server/auto-classify/`, plus one route mount in `src/server/index.ts`:

| File | Purpose |
|---|---|
| `dtw.ts` + `dtw.test.ts` | Pure DTW distance with cosine cost and path-length normalization. |
| `naming.ts` + `naming.test.ts` | Rule-based namer mapping `(segment_type, match, confidence)` → name proposal. Exports `CONFIDENCE_HIGH=0.7`, `CONFIDENCE_LOW=0.4`. |
| `chroma-blob.ts` | Server-side mirror of `packChroma`/`unpackChroma` (no test of its own — exercised through the matcher and routes tests). |
| `repository.ts` + `repository.test.ts` | DB wrappers: `insertFingerprint`, `listFingerprintsForBand`, `listFingerprintsForSong`, `insertClassificationRun`, `updateClassificationRunStatus`. |
| `matcher.ts` + `matcher.test.ts` | `matchSegmentToCorpus(probeChroma, corpus)` runs DTW against every fingerprint, returns `{ match, confidence, raw_distance }`. Confidence is a logistic curve calibrated from POC findings (midpoint 0.10, steepness 30 — see Deviations below). |
| `routes.ts` + `routes.test.ts` | `handleClassifyProject` Hono handler for `POST /api/projects/:id/classify`. Mounted in `src/server/index.ts`. |
| `scripts/poc/phase-3-smoke.ts` | End-to-end smoke check. Output sample captured in `phase-3-smoke.out.json`. |

The route honours every constraint from the design doc and the plan:
- **Auth + membership** identical to `sections.ts`.
- **Idempotency** on `(project_id, audio_hash, classifier_version, fingerprint_version)`: a completed run for the same tuple returns the existing sections with `reused=true` and reuses the run id. Test in `routes.test.ts`.
- **Conflict rule**: an auto segment is dropped when any manual section's `start_ms` falls within ±2 s of the auto segment's `[start_ms, end_ms]` interval. Tests cover both the inside-range and adjacent-to-manual cases.
- **Filter rule** (`shouldEmitSection`): silence / unknown segments are not emitted as sections.
- **Run lifecycle**: row inserted with `status='running'`, transitions to `done` on success or `failed` (with the error message) on exception.

Test counts:
- DTW: 4
- Naming: 10
- Repository: 4
- Matcher: 10 (5 matcher + 5 calibration)
- Routes: 9

Full vitest suite is green at **891 tests** (up from the 854 baseline noted in the task brief).

## (b) Commits

```
75fe74d feat(auto-classify): POST /api/projects/:id/classify endpoint
20d70c7 feat(auto-classify): chroma matcher with DTW + logistic confidence
73680f2 feat(auto-classify): repository for fingerprints + classification runs
39d946f feat(auto-classify): rule-based section naming function
b4eb48a feat(auto-classify): DTW with cosine distance for chroma matching
```

All commits include the `Co-Authored-By: Claude Opus 4.7 (1M context)` trailer. Nothing was pushed to remote and no PR was opened, per the task brief.

## (c) Deviations from the plan and why

1. **DTW cross-sequence test threshold tightened to `>= 0.5`.** The plan's literal test (`toBeGreaterThan(0.5)`) cannot pass against orthogonal vectors with the plan's own normalization formula: for two perpendicular constant sequences of length 3, the optimal path costs sum to 3 and divide by `n+m=6`, giving exactly 0.5. The test now asserts the lower bound, which is the meaningful invariant ("genuinely different sequences are at least 0.5"). The implementation matches the plan code verbatim.

2. **Chroma pack/unpack duplicated into `src/server/auto-classify/chroma-blob.ts` rather than imported from `src/client/lib/auto-classify/chroma.ts` or moved to `src/shared/auto-classify/`.** Two reasons:
   - The Phase 3 brief explicitly forbids touching `src/client/` or `src/shared/` (except for the existing types).
   - The client module imports `meyda` at top level. Bringing it into the Node server bundle would drag a browser-oriented dep along with it.
   The blob layout is identical (little-endian float32, 12 columns, row-major), so blobs uploaded by the client are byte-identical to what the server packs/unpacks. The file's leading comment flags this as future Phase 4 work to consolidate into `src/shared/auto-classify/chroma-blob.ts` once the client is also free to move.

3. **Confidence curve tuned past the plan's starter values.** The plan's `midpoint=0.35`, `steepness=12` were placeholders to be updated against the POC. After working the algebra (the curve must map 0.07 → ≥ CONFIDENCE_HIGH and 0.11 → ≥ CONFIDENCE_LOW), the chosen values are **`midpoint=0.10`, `steepness=30`**, which satisfy both constraints with margin:
   - `d=0.05 → 0.818`, `d=0.07 → 0.711` (above 0.7)
   - `d=0.11 → 0.426` (above 0.4)
   - `d=0.15 → 0.182` (below 0.4)
   `CONFIDENCE_HIGH=0.7` and `CONFIDENCE_LOW=0.4` are kept as the plan suggested. A unit test asserts the boundary mappings.

4. **Response shape includes `end_ms`, `reused`, and `tentative` fields not present in the plan's sketch.** The plan's `routes.ts` sketch returned `{ run_id, sections }` where each section had `start_ms` only. Phase 5 (web client) will render sections with end boundaries derived from the next section's start in storage, but the *response* benefits from carrying `end_ms` (and `tentative`, `confidence`) so the client doesn't need to look anything up. `reused` was added to support the idempotency path so the client can show a different toast for "already done" vs "freshly classified". Wire format documented in section (d).

5. **Response timestamp granularity.** Auto sections are persisted with `created_at`/`updated_at` in **seconds** (matching the rest of the sections table) but the `classification_runs.created_at` / `completed_at` use **milliseconds** (matching the plan's `Date.now()` calls). Both consistent within their own table.

## (d) What Phases 4 and 5 should know

### For Phase 5 (web client)

The full request/response shape is:

```ts
// Request
POST /api/projects/:id/classify
{
  segments: ClassifiedSegment[],   // from src/shared/types.ts
  audio_hash: string,              // sha256 of the audio file bytes (content-hash)
  classifier_version: string,      // e.g. 'yamnet-v1'
  fingerprint_version: number,     // integer, bumps when chroma algo changes
  source_surface: 'web' | 'cli',
}

// Response (200)
{
  run_id: string,
  reused: boolean,                 // true → idempotent replay, sections already exist
  sections: Array<{
    id: string,
    start_ms: number,
    end_ms: number,                // copied from the input segment
    song_id: string | null,
    song_name: string | null,
    label: string | null,          // 'Music' / 'Chatter' / 'Tuning' / 'Count-in', else null
    segment_type: SegmentType,
    confidence: number,            // 0–1; 0 when no match was attempted or corpus empty
    tentative: boolean,            // true when a matched song's confidence is below HIGH but above LOW
  }>,
}
```

Errors:
- `400 invalid_json` / `400 invalid_input` on body validation failures
- `401` from `requireUser` if no session
- `404 not_found` if the project doesn't exist or the user isn't a band member

Important UX notes:
- `reused=true` covers the "user clicked Classify twice in a row" case. The response is the **same sections** (same ids), not a new run. UI should treat that as a no-op refresh, not a duplicate-write.
- `tentative=true` is the signal for the warm-yellow border + "low" chip from the design's "Visual treatment for auto sections" section.
- Sections come back from the route in **segment input order** (which is sorted by `start_ms`). Auto sections persisted to the DB also have stable insertion order, so a refetch via `GET /api/projects/:id/sections` will return them in the same order.
- Auto sections live in the same `sections` table as manual ones, with `source='auto'`. The existing `GET /api/projects/:id/sections` already returns both, so the client doesn't need a new endpoint to hydrate the timeline.

### For Phase 4 (fingerprint corpus building)

- `repository.insertFingerprint(db, row)` is the canonical write path. Schema enforces the FK to `sections`, so the section row must exist first.
- The matcher consumes `fingerprint_blob` as `Buffer` (the better-sqlite3 default for BLOB columns). When Phase 4 computes fingerprints client- or server-side, the **same `packChroma` byte layout** must be used or the matcher will read garbage. The server's `chroma-blob.ts` is the canonical packer for server-side builds; the client's `src/client/lib/auto-classify/chroma.ts` is identical and is the canonical packer for browser-side builds. **If Phase 4 wants to consolidate, the right move is to create `src/shared/auto-classify/chroma-blob.ts` and have both server and client import from it** — a small, safe refactor.
- `fingerprint_version` is meant to be bumped whenever the chroma extraction algorithm changes. The route uses it in the idempotency key so re-running with a new version produces a new run rather than returning stale results.
- `listFingerprintsForSong(db, band_id, song_id)` is provided for Phase 4's "update fingerprints when the user re-labels a section" path, even though the matcher itself only needs `listFingerprintsForBand`.

### Smoke output

`scripts/poc/phase-3-smoke.out.json` (committed) captures the full request/response and DB state for the smoke run. It's a useful reference when wiring Phase 5 against the API — copy/paste-ready fixture.
