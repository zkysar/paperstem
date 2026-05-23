# Large-file buffering (YouTube-style streaming playback) — design + handoff

Status: foundation landed (pure logic + tests); player integration not started.
Date: 2026-05-23.
Branch: `claude/large-file-buffering-ux-xJGls`.

> **Handoff note.** This was scoped and started in a cloud Claude session that
> has **no browser and no audio output**, so the integration (which depends on
> `AudioContext.decodeAudioData` and real playback) could not be built or
> verified there. The pure arithmetic foundation was built and fully unit-tested
> instead. Pick this up in an environment where you can run `npm run dev`, open
> the app in a browser, and **listen** — the seam/sync quality cannot be judged
> any other way. Everything you need to continue is below.

## Goal

Play large/long stems progressively, like YouTube: start playback within ~1s of
pressing play regardless of file length, buffer ahead in the background, show a
buffered-region indicator, and let the user seek into not-yet-loaded regions.
Keep multi-stem playback **sample-accurately synchronized** (this is a hard
requirement — see Architecture).

## Why (two distinct problems)

1. **Latency.** Today the player downloads *and* fully decodes every stem before
   playback can start (`togglePlay` hard-blocks while `state.loading` is set —
   `src/client/hooks/usePlayer.ts:812`). Time-to-first-sound scales with the
   longest stem × number of stems.
2. **Memory (the bigger one).** Decoded PCM is ~10 MB per minute per mono stem at
   44.1 kHz (Float32). A 60-min mono stem ≈ 635 MB decoded; several stems ⇒
   multi-GB ⇒ the browser tab OOMs/crashes. This is the real wall on long
   recordings, and it's why streaming (hold only a *window* of decoded audio) is
   necessary, not just nice.

## Non-goals

- Changing the storage format or the upload pipeline (no server-side
  transcoding/segmentation in v1 — kept as a fallback option, see Open decisions).
- Loose-sync playback via `<audio>` elements + `MediaElementSource`. Rejected:
  media elements drift a few ms, which is audible for phase-locked stems. Zach
  confirmed stems are phase-locked (separated parts of one song / aligned takes).
- WebCodecs `AudioDecoder`. Viable and seam-free, but a bigger lift (needs a
  demuxer). Not needed — the spike below shows range+overlap decode is enough.

## Current architecture (as of this branch)

- **Server** `GET /api/audio/:stem_id` (`src/server/audio.ts:13`) already honors
  HTTP **Range** and streams from disk via `createReadStream` with
  `Accept-Ranges`/`Content-Range`/`Content-Length` (`src/server/storage.ts`). No
  server change is required to fetch byte ranges. Client never uses Range today.
- **Client** `decodeStem()` (`usePlayer.ts:1111`) does
  `fetch(url) → arrayBuffer() → ctx.decodeAudioData(buf)` — whole file, all at
  once. Playback schedules one `AudioBufferSourceNode` per stem off a shared
  `AudioContext` clock via `startSourcesAt(offset)` (`usePlayer.ts:394`), using
  **absolute start times** (`src.start(when, offset)`). That absolute-time
  scheduling is the hook the streaming design builds on.
- **Waveforms** render from precomputed peaks sent in the project API
  (`WaveformThumb.tsx`), so the timeline/waveform already paint *without*
  downloading audio. No change needed there.
- **Metadata**: `duration_ms` and `size_bytes` are stored per stem and returned
  up front (`StemSummary` in `src/client/data/types.ts:45`), so the client knows
  every stem's length and byte size before fetching a byte.
- **Phase 0 (loading legibility) is already shipped**: a loading pill with a live
  progress bar renders while `state.loading` is set (`Player.tsx:871`), and stems
  already decode in parallel (`Promise.all`, `usePlayer.ts:741`). Do **not**
  re-add this. A buffer *frontier* on the timeline should only appear once
  playback can actually start mid-buffer (Phase 1+), or it's misleading.

## Format split (determines seam handling)

- Uploads **> 100 MB** are re-encoded client-side to **mono 64 kbps CBR MP3** via
  lamejs (`src/client/lib/audio-compress.ts:3,36`). Byte offset is linear in time
  (CBR) — `planCbrByteRange` relies on this.
- Uploads **≤ 100 MB** are stored **as-uploaded** (`UploadDrawer.tsx:256`),
  commonly WAV/PCM, which has **no bit reservoir** and segments with zero overlap.
- So the only format needing seam care is the 64 kbps MP3 path.

## Seam spike (already run — conclusions are firm)

The risk with decoding independent MP3 byte ranges is the **bit reservoir**:
frames borrow bits from prior frames (`main_data_begin` backpointer), so a
segment decoded from an arbitrary cut references data before the cut and
produces artifacts. Probed the actual seed files (64 kbps mono, the re-encode
format) by parsing frame headers + side info:

| File | Reservoir used | max `main_data_begin` |
|---|---|---|
| bass.mp3 (64k) | 192/193 frames | **511 B** |
| guitar.mp3 (64k) | 192/193 frames | 508 B |
| drums.mp3 (64k) | 209/210 frames | 473 B |

Conclusions:
1. **Naive stitching WILL click** — ~99% of frames use the reservoir.
2. **The fix is small and bounded.** `main_data_begin` is a 9-bit field ⇒ the
   reservoir reaches back **at most 511 B ≈ 3–4 frames** at 64 kbps. So fetch a
   segment with ~4 frames of *lead-in* before its first frame, decode, then
   discard the lead-in samples (+ the decoder's fixed priming) ⇒ clean seam.
   `RESERVOIR_MAX_BYTES = 512` and `leadInTrimSamples()` encode this.

The throwaway probe script used was `/tmp/mp3-reservoir-probe.mjs` (a
dependency-free MP3 frame parser). It is not committed; re-create from this
description if you want to re-measure a real user file.

## Architecture: segmented AudioBuffer on the shared clock

Keep the Web Audio model. For each stem, decode the timeline in fixed wall-clock
**segments** (default 20 s). Schedule each decoded segment against a single
anchor `t0` (the `ctx.currentTime` corresponding to song position 0) with
`src.start(t0 + segStartSec, ...)`. **Sync is automatic and decode-order
independent**: a segment that finishes decoding late still lands on the exact
sample it belongs to because every segment of every stem references the same
`t0`. Hold a sliding window of decoded segments and evict the rest (caps memory).

## What's landed on this branch

`src/client/lib/segment-stream.ts` (+ `segment-stream.test.ts`, 43 tests, all
green; full suite 1322 passing; tsc clean). Pure — no fetch, no Web Audio, no
DOM. API:

- `planSegments(durationSec, segmentSec=20) → SegmentPlan` — `{ segmentSec,
  durationSec, count, segments:[{index,startSec,endSec}] }`. Uses `index*seg`
  boundaries (no float drift); clamps the last segment to duration.
- `segmentIndexAt(plan, timeSec) → number` — clamped to `[0, count-1]`.
- `selectWindow(plan, playheadSec, decoded:Set<number>, window={behindSec:10,
  aheadSec:40}) → { needed, toFetch, toEvict }`. `toFetch` is priority-ordered
  (current segment, then forward, then backward); `toEvict` is decoded segments
  outside the window.
- `contiguousFrontierSec(plan, decoded, fromIndex) → number` — end time of the
  unbroken decoded run from `fromIndex`; if `fromIndex` isn't decoded, returns
  its `startSec`.
- `mixFrontierSec(plan, perStemDecoded:Set<number>[], fromIndex) → number` — min
  frontier across active (audible) stems. **Empty array ⇒ returns
  `durationSec`** (all-muted plays freely; do not treat as 0 — that was a bug the
  reviewer caught).
- `planCbrByteRange({startSec,endSec,durationSec,fileByteLength,headerBytes?,
  leadInBytes?}) → {start,end} | null` — half-open `[start,end)`; HTTP header is
  `bytes=${start}-${end-1}`. First segment: no lead-in, starts at `headerBytes`.
  Last segment: runs to EOF (captures the encoder's flushed tail).
- `leadInTrimSamples(decodedStartSec, segmentStartSec, sampleRate,
  decoderDelaySamples=0) → number`.

## Integration plan (NOT started — this is the work)

All in/around `src/client/hooks/usePlayer.ts` plus a new fetch/decode module and
some UI. Suggested as ~4 incremental PRs:

### PR 1 — segment fetch/decode + head-start playback
- New module `src/client/lib/decode-segment.ts`: `fetchAndDecodeSegment(ctx, url,
  byteRange, { format, segmentStartSec, sampleRate })`. Uses `fetch` with a
  `Range` header (server already supports it, `audio.ts`). For MP3: request the
  lead-in-extended range from `planCbrByteRange`, snap `start` forward to the
  next frame sync (`0xFF 0xEx`), `decodeAudioData`, then drop
  `leadInTrimSamples(...)` leading samples into a fresh trimmed `AudioBuffer`.
  For WAV: exact slice, no trim. **This module needs a browser to test**
  (`decodeAudioData`); cover its byte math with the existing pure helpers and
  add a Playwright assertion (below).
- `LoadedStem` (`types.ts:67`) gains a per-stem segment store: replace the single
  `audioBuffer` with a `Map<segmentIndex, AudioBuffer>` plus the `SegmentPlan`
  (keep `audioBuffer` working for the legacy whole-file path during transition,
  or convert fully). Track `decoded: Set<number>` per stem.
- `startSourcesAt` / `stopSources` → schedule/stop *all currently-decoded
  segments* of each stem at `t0 + segStartSec` with `start(when, 0, segDuration)`.
  Maintain `t0` so it survives pause/seek (derive from the existing
  `playStartCtxTimeRef`/`playStartOffsetRef`).
- `load()` (`usePlayer.ts:650`): build segment plans from `metaDuration`; fetch +
  decode only the **first window** per stem; start playback as soon as segment 0
  of every active stem is ready. Drop the "block until everything loaded" gate in
  `togglePlay` (`usePlayer.ts:812`) — gate on first-window-ready instead.
- Background fill: after start, walk `selectWindow().toFetch` and decode+schedule
  ahead.

### PR 2 — eviction + memory cap
- On each rAF tick (or a coarser timer), run `selectWindow`; decode `toFetch`,
  free `toEvict` (stop the scheduled source for that segment, drop the buffer).
  This is what actually caps memory on long files.

### PR 3 — seek into unbuffered + buffered-region UI
- `seek()` (`usePlayer.ts:923`): compute target segment, ensure it's decoded for
  active stems before resuming, reschedule from `t0`; cancel/deprioritize
  in-flight fetches for the old position (generation counter, mirror
  `loadGenRef`).
- UI: render the mix frontier (`mixFrontierSec`) as a YouTube-style buffered
  region on `Minimap.tsx` and/or the timeline in `Player.tsx`. Reuse/extend the
  existing loading pill plumbing.

### PR 4 — underrun + mobile polish
- Underrun: if the playhead reaches the frontier, pause sources, show a buffering
  spinner *at the playhead*, auto-resume when the window refills — never reset
  position.
- Mobile: smaller window + throttle read-ahead on cellular
  (`navigator.connection.effectiveType` / `saveData`). CLAUDE.md requires mobile
  (~390px) verification for UI changes.

## Verification requirements (do not skip)

- `npx vitest run` and `npx tsc --noEmit` — must stay green.
- **Browser + audio (human):** play a multi-stem project; confirm (a) playback
  starts before the whole file downloads, (b) stems stay phase-locked (solo two
  stems that share a transient and confirm no flam/echo at segment boundaries),
  (c) seeking into an unbuffered region works, (d) memory stays bounded on a long
  file (watch the tab's memory in devtools), (e) mobile width is correct.
- **Playwright e2e** (`npm run test:e2e`, required for large UI features per
  CLAUDE.md): add journeys for play-while-buffering and seek-into-unbuffered.
  Note Playwright can assert the buffered overlay and that playback starts
  quickly, but it cannot judge seam audio quality — that's the human listen.
- Per CLAUDE.md review-delegation: this will exceed 500 changed lines ⇒ 5
  parallel topical reviewers + a UX reviewer (it touches `src/client/`).

## Open decisions for the next session

1. **Client byte-math vs. server time-range endpoint.** `planCbrByteRange` does
   the byte estimate client-side (simplest, works for CBR + WAV). Alternative:
   add `GET /api/audio/:id?from=<sec>&to=<sec>` so the server (which has the whole
   file) snaps to frame boundaries and handles VBR/odd headers. Cleaner and more
   robust, but more server code. Recommend starting client-side; switch if VBR or
   header-offset estimation bites.
2. **`headerBytes` for the CBR estimate** must include the full ID3v2 + Xing/Info
   header, or the estimate runs short. Parse it once per stem on first fetch.
3. **Segment size / window config** (20 s / 10 s behind / 40 s ahead) are guesses
   — tune against real network + memory behavior.
4. **VBR / non-MP3 compressed uploads** (≤100 MB files kept as-is could be VBR
   MP3, AAC, etc.). CBR byte math is wrong for VBR. v1 can fall back to the
   existing whole-file decode for formats it can't segment cleanly, and only
   stream CBR-MP3 + PCM.
