// Pure timing + coverage helpers for buffered segment playback. No Web Audio,
// no React. "Session anchor index" j fixes where the current play/seek session
// anchors its timeline: index j sits at j*segmentSec (shared across stems so
// they stay sample-aligned), and later indices accumulate ACTUAL decoded
// durations forward. j=0 (linear play) reduces to actual-from-0 (Phase 1).

export type SegTiming = { startSec: number; endSec: number };

/** Nominal start time of a segment index (CBR: index * segmentSec). */
export function nominalStart(index: number, segmentSec: number): number {
  return index * segmentSec;
}

/**
 * Start/end times for the contiguous run of decoded segments beginning at the
 * session anchor index `j`. Anchored at nominalStart(j); each subsequent
 * contiguous index accumulates its own actual duration. Stops at the first
 * forward gap. Empty if `j` itself isn't decoded.
 */
export function sessionTimings(
  j: number,
  durationsByIndex: Map<number, number>,
  segmentSec: number,
): Map<number, SegTiming> {
  const out = new Map<number, SegTiming>();
  let start = nominalStart(j, segmentSec);
  for (let i = j; durationsByIndex.has(i); i++) {
    const dur = durationsByIndex.get(i)!;
    out.set(i, { startSec: start, endSec: start + dur });
    start += dur;
  }
  return out;
}

/** True iff some timing range [startSec, endSec) contains p. */
export function coversTime(timings: Map<number, SegTiming>, p: number): boolean {
  for (const t of timings.values()) {
    if (p >= t.startSec && p < t.endSec) return true;
  }
  return false;
}

export type StemSource =
  | { kind: 'segments'; coveredAtP: boolean }
  | { kind: 'buffer'; durationSec: number }
  | { kind: 'errored' };

export type CoverageStem = { userMuted: boolean; soloed: boolean; source: StemSource };

/**
 * Is position `p` covered for every stem that would actually sound at `p`?
 * Sounding = solo-aware (any soloed → only soloed; else non-muted). Stems past
 * their own end, and errored stems, are excluded from the gate. Empty sounding
 * set is vacuously covered (user muted everything → silence is intentional).
 */
export function isCovered(p: number, stems: CoverageStem[]): boolean {
  const anySolo = stems.some((s) => s.soloed && s.source.kind !== 'errored');
  for (const s of stems) {
    if (s.source.kind === 'errored') continue;
    const sounding = anySolo ? s.soloed : !s.userMuted;
    if (!sounding) continue;
    if (s.source.kind === 'buffer') continue; // full file decoded → never blocks
    if (!s.source.coveredAtP) return false;
  }
  return true;
}

/**
 * Next segment index a stem's fill should fetch: lowest undecoded, non-errored
 * index at/after the cursor; else lowest such index before the cursor (backfill);
 * else null.
 */
export function nextFillIndex(
  decoded: Set<number>,
  errored: Set<number>,
  cursor: number,
  count: number,
): number | null {
  const avail = (i: number) => !decoded.has(i) && !errored.has(i);
  for (let i = cursor; i < count; i++) if (avail(i)) return i;
  for (let i = 0; i < cursor; i++) if (avail(i)) return i;
  return null;
}
