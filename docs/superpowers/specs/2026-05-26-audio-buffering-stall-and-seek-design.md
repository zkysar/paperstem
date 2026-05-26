# Audio Buffering: Stall-and-Resume + Seek-Prioritized Fetch — Design

**Date:** 2026-05-26
**Status:** Approved (brainstorming), revised after design review → next: implementation plan
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
- Preserve Phase 1's sample-accurate multi-track sync and gapless within-stem scheduling. **The no-seek linear case must remain byte-for-byte today's behavior.**

## Non-goals

- Buffer-frontier ("loaded up to here") bar on the timeline/minimap. (Possible later.)
- Segment eviction / memory cap (still Phase 1's "keep everything" model).
- Changing the server, storage, or any DB/API surface.
- Request cancellation (`AbortController`) for superseded/repositioned fetches — noted as a fast-follow, not in this scope (see §Seek-prioritized fill).

## Design

### Coverage predicate (the heart of it)

A position `p` is **covered** if, for **every stem that would actually sound at `p`**, the audio for `p` is decoded. "Would actually sound" mirrors the existing mute/solo gain logic (usePlayer.ts gain effect): if any stem is soloed, only soloed stems sound; otherwise all non-`userMuted` stems sound. A stem is decoded-at-`p` if either:
- it is a **segment (MP3) stem** and a decoded segment's `[startSec, endSec)` contains `p`; or
- it is a **full-decode (non-MP3 / fallback) stem** — it has a single `audioBuffer` and no `segmentsRef` entry — and `p < audioBuffer.duration` (it is fully decoded once present, so it is always covered within its own length).

Stems that don't contribute at `p` are **excluded** from the gate (they neither block nor help):
- a stem whose length is `<= p` (it is silent past its own end, like the existing shorter-stem skip in `startSourcesAt`);
- a stem that **errored** (no usable segments/buffer — it can never become covered; see Failure handling).

**Empty sounding-set ⇒ covered.** If no stem would sound at `p` (everything muted, or a solo set that contributes nothing here), coverage is vacuously true and playback proceeds — silent because the *user* muted, which is expected and distinct from the unbuffered-silence this spec fixes.

This one predicate handles both triggers uniformly: seek into a gap → not covered → stall; linear playback running off the decoded end → becomes not-covered → stall. Emergent behavior: muting (or soloing away) the un-buffered stem flips the predicate true → playback proceeds.

The predicate lives in a pure helper (`segment-runs.ts`) so it is unit-testable without Web Audio.

### Start times: actual-from-0, with shared provisional anchoring for forward seeks

(This replaces the design-review-rejected "contiguous runs with re-anchor-on-merge" model, which could shift a *currently-playing* region when a gap closed — the very case a seek→backfill produces.)

Segments are keyed by index (`Map<number, DecodedSeg>`) so the fill can decode them out of order. A segment's start time on the transport timeline is assigned as follows:

- **Truth (the default, = Phase 1):** segment `k`'s `startSec` is the running sum of the **actual decoded durations** of all lower-index segments `[0..k-1]`. This is drift-free and gapless and is what keeps stems sample-synced. **Linear playback — one decoded prefix growing from index 0 — is byte-for-byte identical to Phase 1.** (Phase 1 already does exactly this; the only change is index-keyed storage instead of a pushed contiguous array.)
- **Provisional (forward seek into a gap):** after a forward seek to index `k` whose lower neighbors `[0..k-1]` aren't all decoded, `startSec[k]` can't be derived from truth yet. Schedule the playable forward region anchored at the **shared nominal start** `nominal(k) = k * SEGMENT_SEC`, accumulating actual durations forward (`startSec[k] = nominal(k)`, `startSec[k+1] = nominal(k) + actualDuration[k]`, …). Because **every stem repositions to the same index `k` and uses the same `nominal(k)`**, the stems stay aligned *with each other* by construction, independent of the small nominal-vs-true offset (which is inaudible at a seek point and bounded by accumulated lead-in-trim drift, ~tens of ms over minutes).
- **Lazy correction, never a disruptive shift.** When `[0..k-1]` later backfill and the true `startSec[k]` becomes derivable, the correction is applied only at the **next natural reschedule** (a subsequent seek, loop-wrap, or stall-resume) — never by yanking a region the playhead is currently inside. The transient provisional offset is shared across stems, so it neither desyncs the mix nor produces an audible jump.

The per-segment scheduling math is unchanged: `computeSegmentSchedule` still takes each segment's `{startSec, endSec}` against the single play anchor, so `segment-scheduler.ts` needs no rework. The bookkeeping of which segments have a known-true vs provisional `startSec` (a contiguous-from-0 check) lives in the pure `segment-runs.ts` helper.

### Stall / resume engine (modeled as auto-pause-at-position)

To avoid the wall-clock-keeps-running trap, **stall is modeled as an automatic pause at a frozen position with intent-to-resume**, using a `stallPosRef` as the position source of truth while buffering:

- **Detection.**
  - *Seek-into-uncovered is detected synchronously inside `seek()`*: it already computes the clamped target, so it runs the coverage check there; if uncovered, it sets `buffering = true` and `stallPosRef = target` immediately (no waiting for the next frame), and the coalesced-seek reschedule becomes a no-op while buffering. This avoids a race between the main rAF tick and the coalesced-seek rAF (they must not both drive scheduling).
  - *Linear underrun is detected by the main rAF tick*: while playing, each frame computes `p`; if `p` is not covered, enter stall at `p`.
- **Stall state.** `stopSources()`; `stallPosRef = stallPos`; set reducer `buffering = true`. `isPlayingInternalRef` stays **true** so the tick keeps polling coverage, **but while `buffering`, position comes from `stallPosRef`, not the wall clock** — `computeCurrentTime()`/`pause()`/the displayed cursor all read `stallPosRef`. The tick, while `buffering`, **short-circuits before the loop-wrap and end-of-song checks** (otherwise a stall near a stem's end or across `loop.end` would spuriously end/wrap).
- **Resume.** The tick (still running, since `isPlayingInternalRef` is true) re-checks coverage at `stallPosRef` every frame — so segment arrivals *and* mute/solo changes are both picked up automatically with no separate code path. When it becomes covered: clear `buffering`, re-anchor and `startSourcesAt(stallPos)` (synchronous — the `AudioContext` was never suspended, so no iOS gesture needed), **and reset `lastTRef = stallPos`** so the loop-wrap gate doesn't fire spuriously on the position jump.
- **Pause / play during stall.** Because `stallPosRef` is the position source of truth while buffering, `pause()` captures `stallPos` correctly, and a later play resumes from there — stall composes with the existing pause/`togglePlay` as "a pause that auto-resumes."

### Seek-prioritized, cursor-driven fill

Phase 1's fill is a fixed sequential loop. It becomes **cursor-driven**, with **exactly one long-lived fill loop per stem** (not a new fill spawned per seek):

- Each stem's loop reads a mutable `cursorRef`. The **next index to fetch** = `min(undecoded ∩ [cursor, lastIndex])` if non-empty, else `min(undecoded ∩ [0, cursor))` (forward from the cursor, then backfill earlier gaps). It draws only from the *undecoded* set (which shrinks on each success) and excludes **errored** indices, so it terminates and cannot livelock. Index 0 is always already decoded from the head step, so it's never re-fetched.
- A **seek to `T` repositions every stem's cursor** to `clamp(floor(T / SEGMENT_SEC), 0, lastIndex)` — using each stem's *own* `lastIndex` (stems can differ in length/segment count). The cursor's target segment is fetched **next** (jumped to the front), so a slow in-flight fetch of some other segment doesn't delay the seek target. **No seek → the cursor never moves → identical to today's sequential fill.**
- Phase 1's `loadGenRef` gen-guard still protects against project switches (every await re-checks it). Without `AbortController`, a repositioned cursor lets at most one already-in-flight fetch per stem complete-then-discard; that bounded waste is acceptable for v1, with abort as a fast-follow.

### Buffering UI

A `buffering: boolean` field in the player reducer. The existing loading-pill component renders with a defined **precedence**: `loading ? "Loading…" : buffering ? "Buffering…" : (none)`. They are mutually exclusive in practice — `loading` blocks play entirely (Phase 1 `togglePlay` NUDGEs while loading), and `buffering` only exists after play has started — so there's no overlap. (Note: an immediate play right after head-ready, before segment 1 arrives, is a legitimate linear underrun and correctly shows "Buffering…".) No timeline/minimap changes.

### Failure handling

If the segment covering `stallPos` fails to fetch/decode (network drop, 410 ghost) rather than arriving, the stall must not hang forever:
- A stem whose covering segment permanently errors is dropped from the coverage gate (excluded, like a fully-errored stem), so the remaining stems can resume; the fill's next-index set excludes errored indices so it doesn't spin.
- If *no* stem can cover `stallPos`, surface the existing error/status affordance (the status line) rather than freezing indefinitely. Reuse Phase 1's per-segment `try/catch` (stops a stem's fill at its last good segment) and the existing ghost-stem (410) handling.

## Components / files

- **New** `src/client/lib/segment-runs.ts` (pure, unit-testable): from a stem's index-keyed decoded segments + actual durations, derive each segment's `startSec` (truth when the `[0..k-1]` prefix is contiguous-decoded; shared-nominal provisional otherwise) and expose `isCovered(position, stems, muteSoloState)` (segment stems, full-decode stems, excluded/errored/past-end stems, empty-sounding-set) and the next-fill-index rule. No Web Audio, no React.
- **Modify** `src/client/hooks/usePlayer.ts`:
  - Segment storage: index-keyed (`Map<number, DecodedSeg>`) per stem.
  - rAF tick: per-frame coverage check → stall/resume; while `buffering`, read position from `stallPosRef` and short-circuit loop-wrap/end-of-song; reset `lastTRef` on resume.
  - `seek`: synchronous coverage check → set `buffering`/`stallPosRef` when uncovered; reposition each stem's fill cursor.
  - `startSourcesAt` / `scheduleDecodedSegment`: take each segment's `startSec` from `segment-runs` (truth or provisional); no-op while `buffering`.
  - `computeCurrentTime` / `pause`: read `stallPosRef` while `buffering`.
  - Background fill: one long-lived cursor-driven loop per stem.
  - `SET_DURATION` reconciliation (added in Phase 1): compute each stem's end from its full `[0..N-1]` actual-duration sum once complete (or highest contiguous index), **not** the "last pushed segment" — the index-keyed/sparse store breaks that assumption.
  - New `buffering` reducer field + action.
- **Modify** the loading-pill component: render the `buffering` state per the precedence above.

## Testing

- **Unit (`segment-runs.test.ts`):** `startSec` truth (contiguous-from-0 prefix) vs shared-nominal provisional (forward-seek gap); coverage predicate across segment stems, full-decode stems, past-own-end exclusion, errored exclusion, empty sounding-set, and mute/solo gating; next-fill-index rule (forward then backfill, excludes decoded + errored, terminates).
- **Hook (`usePlayer.test.ts`):** seek into a gap → `buffering` true + cursor frozen at `stallPos` + no scheduled source; covering segment arrives → resumes with a source at `stallPos` and `lastTRef` reset; linear underrun → stalls at the frontier (no spurious end-of-song when a short stem's end coincides); muting the un-buffered stem mid-stall → resumes; pause during stall captures `stallPos`; seek repositions the fill cursor and fetches its target first; linear no-seek path unchanged (regression).
- **E2E (Playwright):** seek ahead on a **multi-segment** project → "Buffering…" pill + frozen cursor → resumes with sound at the seek point. The ~5s dev seed is single-segment, so this needs a **committed small multi-segment fixture** (a ~60s 64 kbps mono MP3 → 3 segments) rather than relying on network throttling alone — the repo's CI history shows time-window assertions under throttling are flaky (the Phase 1 "poll for playhead advance" fix). Assert on buffering-state presence + post-resume advance, not precise timecodes.

## Open risks (carried into the plan)

- **Cross-stem alignment under mixed sample rates.** Per-index time durations should match across stems (a 20 s nominal segment is ~20 s at any rate), and the shared-nominal anchor keeps forward-seek regions aligned by construction, but a mixed 44.1/48 kHz project should be verified end-to-end — the actual within-region accumulation uses each stem's own decoded durations.
- **Provisional→truth correction timing.** The lazy correction (apply only at the next natural reschedule) is correct for sync but means a seeked region's displayed time can sit a few tens of ms off the true timeline until then. Confirm this is imperceptible and that end-of-song/`SET_DURATION` use truth, not the provisional offset.
- **No request cancellation.** Rapid re-seeks discard at most one in-flight fetch per stem (bounded), but a slow/stuck fetch under the cursor blocks the prioritized target behind it until it settles. Acceptable for v1; `AbortController` is the natural fast-follow.
