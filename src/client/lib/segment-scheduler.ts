export type Anchor = { ctxAtPlay: number; posAtPlay: number };
export type SegRange = { startSec: number; endSec: number };
export type ScheduleResult = { skip: true } | { skip: false; when: number; offset: number };

// Tighter than the 50ms initial-play lookahead in usePlayer.ts (startSourcesAt):
// this is the per-segment reschedule window, not the play-start window — don't
// unify the two constants, they serve different paths.
const INSIDE_LOOKAHEAD = 0.02;

/** Decide when/where to start a segment source given the play anchor and the current ctx time. */
export function computeSegmentSchedule(
  seg: SegRange,
  anchor: Anchor,
  pNow: number,
  ctxNow: number,
): ScheduleResult {
  if (seg.endSec <= pNow) return { skip: true };
  if (seg.startSec <= pNow) {
    // playhead is inside this segment -- schedule immediately with a small lookahead buffer
    return {
      skip: false,
      when: ctxNow + INSIDE_LOOKAHEAD,
      offset: pNow - seg.startSec + INSIDE_LOOKAHEAD,
    };
  }
  // segment is ahead of the playhead -- compute its nominal AudioContext start time
  const nominalWhen = anchor.ctxAtPlay + (seg.startSec - anchor.posAtPlay);
  if (nominalWhen < ctxNow) {
    // Defensive: under a CONSISTENT playback clock (the caller must derive pNow as
    // posAtPlay + (ctxNow - ctxAtPlay)), startSec > pNow implies nominalWhen > ctxNow,
    // so this branch is unreachable in normal playback. Kept as cheap insurance so a
    // stale anchor / FP drift can never call src.start(when) with when in the past.
    return { skip: false, when: ctxNow, offset: 0 };
  }
  // future segment scheduled on time
  return { skip: false, when: nominalWhen, offset: 0 };
}
