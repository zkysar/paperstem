import { describe, it, expect } from 'vitest';
import { computeSegmentSchedule } from './segment-scheduler';

// anchor: at ctx time A=10, position was P0=0. ctxNow=12 -> pNow=2.
const anchor = { ctxAtPlay: 10, posAtPlay: 0 };

describe('computeSegmentSchedule', () => {
  it('skips a segment fully behind the playhead', () => {
    const r = computeSegmentSchedule({ startSec: 0, endSec: 2 }, anchor, 2, 12);
    expect(r).toEqual({ skip: true });
  });
  it('schedules a future segment at its absolute time, offset 0', () => {
    const r = computeSegmentSchedule({ startSec: 4, endSec: 6 }, anchor, 2, 12);
    // when = A + (startSec - P0) = 10 + 4 = 14; offset 0
    expect(r).toEqual({ skip: false, when: 14, offset: 0 });
  });
  it('schedules the segment the playhead is inside at ~now with a buffer offset', () => {
    const r = computeSegmentSchedule({ startSec: 1, endSec: 5 }, anchor, 2, 12);
    // inside: when ~= ctxNow + 0.02 = 12.02; offset = pNow - startSec + 0.02 = 1.02
    expect(r.skip).toBe(false);
    if (!r.skip) {
      expect(r.when).toBeCloseTo(12.02, 5);
      expect(r.offset).toBeCloseTo(1.02, 5);
    }
  });
  it('clamps a late-arriving future segment to now instead of the past', () => {
    // NOTE: this clock is intentionally INCONSISTENT — a consistent anchor would give
    // pNow=7, not 2. The future-branch clamp is unreachable in normal playback (see the
    // defensive-clamp comment in segment-scheduler.ts); this test only guards that path.
    // segment [3,5), pNow=2 (playhead still before startSec).
    // anchor: ctxAtPlay=5, posAtPlay=0. nominalWhen = 5 + (3-0) = 8 < ctxNow=12 -> late arrival.
    // startSec=3 > pNow=2: future from playhead's perspective; offset=0.
    const lateAnchor = { ctxAtPlay: 5, posAtPlay: 0 };
    const r = computeSegmentSchedule({ startSec: 3, endSec: 5 }, lateAnchor, 2, 12);
    expect(r).toEqual({ skip: false, when: 12, offset: 0 });
  });
  it('treats a segment starting exactly at pNow as inside, schedules at ~now with lookahead offset', () => {
    // boundary: startSec === pNow=2, so startSec <= pNow -> inside path
    // when = ctxNow + 0.02 = 12.02; offset = pNow - startSec + 0.02 = 0 + 0.02 = 0.02
    const r = computeSegmentSchedule({ startSec: 2, endSec: 4 }, anchor, 2, 12);
    expect(r.skip).toBe(false);
    if (!r.skip) {
      expect(r.when).toBeCloseTo(12.02, 5);
      expect(r.offset).toBeCloseTo(0.02, 5);
    }
  });
});
