# Audio Buffering: Stall-and-Resume + Seek-Prioritized Fetch — Design

**Date:** 2026-05-26
**Status:** Approved (brainstorming) → next: implementation plan
**Builds on:** Phase 1 head-start segment streaming (PR #263). See `2026-05-24-paperstem-audio-segment-streaming-phase1.md` in `~/projects/plans/`.

## Problem

Phase 1 plays MP3 stems from a head segment immediately and fills the rest in the background. But the transport playhead is driven purely by `computeCurrentTime()` (the `AudioContext` wall clock) — it advances on real time regardless of whether any audio is actually scheduled. So when the playhead enters a region that isn't decoded yet, **the cursor keeps moving and the transport still reads "playing," but there is no sound.** It looks like it's playing when it isn't.

Two ways a user reaches an un-decoded region (Phase 1 handles neither):

1. **Seek ahead** (the reported trigger). The user clicks/seeks to time `T` before the segment covering `T` is downloaded. Worse: the background fill is **strictly in-order from segment 1**, so it does not jump to `T` — the silence persists until the sequential crawl reaches `T`.
2. **Linear underrun.** During normal playback the fill falls behind the playhead — most likely with many stems (they fill in parallel, multiplying bandwidth/CPU demand) or on a slow link. Once the playhead overtakes the decoded frontier, overtaken segments are skipped (their scheduled time is already past) and the rest plays silent.

This was explicitly deferred from Phase 1 (no underrun handling, no seek-into-unbuffered, no buffer-frontier UI). This spec covers the first two; the visual buffer-frontier bar remains out of scope.

## Goals

- Never let the playhead advance silently through an un-decoded region. Instead **stall** (freeze the cursor) and show an honest "Buffering…" state, then **auto-resume** when the audio is ready.
- On seek, **prioritize fetching the segment under the playhead** so the stall is short, instead of waiting for the in-order fill.
- Preserve Phase 1's sample-accurate multi-track sync and gapless within-stem scheduling. The no-seek linear case must remain byte-for-byte today's behavior.

## Non-goals

- Buffer-frontier ("loaded up to here") bar on the timeline/minimap. (Possible later.)
- Segment eviction / memory cap (still Phase 1's "keep everything" model).
- Changing the server, storage, or any DB/API surface.

## Design

### Coverage predicate (the heart of it)

A position `p` is **covered** if, for every stem that would actually sound at `p` (respecting mute/solo), there is a decoded segment whose `[startSec, endSec)` contains `p`.

This one predicate handles both triggers uniformly:
- Seek into an un-decoded gap → `p` not covered → stall immediately.
- Linear playback running off the end of decoded audio → `p` becomes not-covered → stall.

Emergent behavior: a stem that hasn't buffered `p` only blocks playback while it is *sounding*. Muting (or soloing away) that stem flips the predicate true, so playback proceeds — a natural, useful affordance.

"Sounding" mirrors the existing mute/solo gain logic: if any stem is soloed, only soloed stems sound; otherwise all non-`userMuted` stems sound. A stem that **errored entirely** (no segments, no buffer) is excluded from the gate (it can never become covered — see Failure handling).

### Stall / resume engine

- **Detection (per rAF frame, while playing):** compute `p = computeCurrentTime()`. If `p` is covered, advance normally (clamp + loop-wrap + end-of-song exactly as today). If `p` is **not** covered, enter the stalled state.
- **Stall:** `stopSources()`; record `stallPos = p`; the rAF holds `currentTime` at `stallPos` (stops reading the wall clock); set the reducer `buffering` flag true. `isPlayingInternalRef` stays true (intent to play is preserved) — but the wall clock is no longer the source of truth for position while stalled.
- **Resume:** whenever segments arrive (background fill / prioritized fetch completion) or mute/solo changes, re-check coverage at `stallPos`. When it becomes covered, exit the stalled state: re-anchor and `startSourcesAt(stallPos)` (synchronous — the `AudioContext` was never suspended, so no iOS user-gesture is required), clear `buffering`.

Because resume re-anchors via the existing `startSourcesAt` (which sets `playStartCtxTimeRef`/`playStartOffsetRef` and schedules every decoded segment covering the position), the consistent-clock invariant the scheduler relies on is preserved across a stall.

### Seek-prioritized, cursor-driven fill

Phase 1's fill is a fixed sequential loop (`segments 1..N`). It becomes **cursor-driven**:

- Each stem has a *fill cursor* — the segment index it will fetch next. The fill repeatedly fetches the lowest-index not-yet-decoded segment at or after the cursor, runs forward to the end, then backfills any remaining lower-index gaps, until all segments are decoded.
- A **seek to `T` repositions every stem's cursor** to the segment index covering `T` (nominal CBR mapping: `clamp(floor(T / SEGMENT_SEC), 0, lastIndex)` — all stems use the same index, keeping their runs aligned). The in-flight fetch finishes, then the fill continues from the new cursor.
- **No seek → the cursor never moves → identical to today's sequential fill.**

### Segments stored by index; scheduled as contiguous "runs"

Jumped filling means a stem's decoded segments can form more than one contiguous block — e.g. `[0..oldFrontier]` plus a new `[Tseg..]` after a seek. Therefore:

- Segments are keyed by index (e.g. `Map<number, DecodedSeg>`) rather than a contiguous pushed array.
- The decoded indices group into maximal **contiguous runs**. **Each run's start time is anchored at the *nominal* start of its first segment** (`firstIndex * SEGMENT_SEC`), and within a run, `startSec` accumulates the **actual decoded durations** (`startSec[k+1] = startSec[k] + actualDuration[k]`).
- This preserves exact gaplessness and drift-free scheduling *within the run the playhead occupies* — which is what keeps stems sample-synced while listening. Gaps between runs are tolerated (the user skipped that material); if later filled, the runs merge and the merged run re-anchors at its first segment's nominal start.
- All stems reposition to the same segment index on a seek, so their runs share the same nominal anchor and stay aligned. For identical-segmentation stems (same song, same encoder/segmentation, same byte ranges), per-index decoded durations match across stems, so runs stay sample-aligned forward from the anchor.

The common case — linear playback, no seek — is a single run anchored at 0 with running actual durations: **exactly Phase 1's current behavior.**

### Buffering UI

A `buffering: boolean` field in the player reducer. The existing loading-pill component renders a "Buffering…" indicator while `buffering` is true. Combined with the frozen cursor, this removes the "looks like it's playing" illusion. No timeline/minimap changes.

### Failure handling

If the segment covering `stallPos` fails to fetch/decode (network drop, 410 ghost) rather than arriving, the stall must not hang forever:
- A stem whose covering segment permanently errors is dropped from the coverage gate (excluded, like a fully-errored stem), so the remaining stems can resume.
- If *no* stem can cover `stallPos`, surface the existing error/status affordance (e.g. the status line) rather than freezing indefinitely. Reuse Phase 1's per-segment `try/catch` (which already stops a stem's fill at its last good segment) plus the existing ghost-stem (410) handling.

## Components / files

- **New** `src/client/lib/segment-runs.ts` (pure, unit-testable): given a stem's decoded segments (by index) + their actual durations, produce the contiguous runs with per-run anchored start times; expose a coverage check (`isCovered(position, stems, muteSoloState)`) and the run lookup used by scheduling. No Web Audio, no React.
- **Modify** `src/client/hooks/usePlayer.ts`:
  - rAF tick: per-frame coverage check → stall/resume; hold `currentTime` while stalled.
  - `startSourcesAt` / `scheduleDecodedSegment`: schedule from run-anchored start times (via `segment-runs`).
  - Background fill: cursor-driven instead of fixed sequential; `seek` repositions the cursor.
  - Segment storage: keyed by index; runs computed from it.
  - New `buffering` reducer field + action; resume re-check on segment arrival and on mute/solo change.
- **Modify** the loading-pill component: render the `buffering` state.

## Testing

- **Unit (`segment-runs.test.ts`):** run grouping from sparse indices; per-run start-time anchoring + within-run actual-duration accumulation; coverage predicate including mute/solo gating and the errored-stem exclusion; nominal seek→index mapping.
- **Hook (`usePlayer.test.ts`):** seek into an un-decoded gap → stalls (buffering true, cursor frozen); covering segment arrives → resumes with a scheduled source at `stallPos`; linear underrun → stalls at the frontier; muting the un-buffered stem during a stall → resumes; seek repositions the fill cursor (prioritized-fetch order).
- **E2E (throttled, Playwright):** seek ahead on a multi-segment project → buffering pill appears + cursor frozen → playback resumes with sound at the seek point. (Requires a project large enough to be multi-segment under throttling; the ~5s dev seed is single-segment, so this journey needs network throttling and/or a larger fixture — note in the test.)

## Open risks

- **Run re-anchoring on merge.** When a gap fills and two runs merge, the merged run re-anchors at its first segment's nominal start; if the playhead is mid-run during the merge, scheduling must not jump. Mitigation: only (re)anchor runs not currently being played through, or re-anchor at the next safe reschedule (seek/stall-resume). Detail to resolve in the plan.
- **Cross-stem run alignment under mixed sample rates.** Per-index time durations should match across stems (a 20s segment is 20s at any rate), but verify a mixed 44.1/48 kHz project stays aligned forward from a shared anchor.
- **Larger e2e fixture.** Demonstrating real seek-ahead buffering needs a multi-segment file; the dev seed is too small. Decide in the plan whether to add a fixture or rely on throttling + the unit/hook coverage.
