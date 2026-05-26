import { describe, it, expect } from 'vitest';
import { nominalStart, sessionTimings, coversTime, isCovered, nextFillIndex } from './segment-runs';

const SEG = 20;
const d = (entries: [number, number][]) => new Map<number, number>(entries);

describe('nominalStart', () => {
  it('is index * segmentSec', () => {
    expect(nominalStart(0, SEG)).toBe(0);
    expect(nominalStart(3, SEG)).toBe(60);
  });
});

describe('sessionTimings', () => {
  it('anchors the run at 0 for j=0 and accumulates ACTUAL durations (Phase 1 case)', () => {
    const t = sessionTimings(0, d([[0, 19.9], [1, 19.8], [2, 19.95]]), SEG);
    expect(t.get(0)).toEqual({ startSec: 0, endSec: 19.9 });
    expect(t.get(1)).toEqual({ startSec: 19.9, endSec: 39.7 });
    // floating-point accumulation: 19.9+19.8+19.95 = 59.650000000000006 in JS
    expect(t.get(2)!.startSec).toBeCloseTo(39.7, 10);
    expect(t.get(2)!.endSec).toBeCloseTo(59.65, 10);
  });
  it('anchors a forward-seek run at j*segmentSec (shared nominal), not actual-from-0', () => {
    const t = sessionTimings(3, d([[3, 19.9], [4, 19.8]]), SEG);
    expect(t.get(3)).toEqual({ startSec: 60, endSec: 79.9 });
    expect(t.get(4)).toEqual({ startSec: 79.9, endSec: 99.7 });
  });
  it('stops at the first forward gap (omits segments past it)', () => {
    const t = sessionTimings(0, d([[0, 20], [1, 20], [3, 20]]), SEG);
    expect(t.has(2)).toBe(false);
    expect(t.has(3)).toBe(false);
    expect(t.get(1)).toEqual({ startSec: 20, endSec: 40 });
  });
  it('is empty when the anchor index itself is not decoded', () => {
    expect(sessionTimings(5, d([[0, 20], [1, 20]]), SEG).size).toBe(0);
  });
});

describe('coversTime', () => {
  it('true iff a timing range contains p (half-open)', () => {
    const t = sessionTimings(0, d([[0, 20], [1, 20]]), SEG);
    expect(coversTime(t, 0)).toBe(true);
    expect(coversTime(t, 39.9)).toBe(true);
    expect(coversTime(t, 40)).toBe(false);
    expect(coversTime(t, 50)).toBe(false);
  });
});

describe('isCovered', () => {
  const seg = (covered: boolean) => ({ kind: 'segments' as const, coveredAtP: covered });
  const buf = (dur: number) => ({ kind: 'buffer' as const, durationSec: dur });
  const errored = { kind: 'errored' as const };

  it('true when every sounding stem is covered at p', () => {
    expect(isCovered(10, [
      { userMuted: false, soloed: false, source: seg(true) },
      { userMuted: false, soloed: false, source: seg(true) },
    ])).toBe(true);
  });
  it('false when any sounding stem is not covered', () => {
    expect(isCovered(10, [
      { userMuted: false, soloed: false, source: seg(true) },
      { userMuted: false, soloed: false, source: seg(false) },
    ])).toBe(false);
  });
  it('ignores muted stems (mute the unbuffered stem → covered)', () => {
    expect(isCovered(10, [
      { userMuted: false, soloed: false, source: seg(true) },
      { userMuted: true, soloed: false, source: seg(false) },
    ])).toBe(true);
  });
  it('respects solo (only soloed stems gate)', () => {
    expect(isCovered(10, [
      { userMuted: false, soloed: true, source: seg(true) },
      { userMuted: false, soloed: false, source: seg(false) },
    ])).toBe(true);
  });
  it('full-decode (buffer) stem is covered while p < its duration, excluded past its end', () => {
    expect(isCovered(10, [{ userMuted: false, soloed: false, source: buf(30) }])).toBe(true);
    expect(isCovered(40, [{ userMuted: false, soloed: false, source: buf(30) }])).toBe(true);
  });
  it('excludes errored stems from the gate', () => {
    expect(isCovered(10, [
      { userMuted: false, soloed: false, source: seg(true) },
      { userMuted: false, soloed: false, source: errored },
    ])).toBe(true);
  });
  it('empty sounding-set is vacuously covered', () => {
    expect(isCovered(10, [{ userMuted: true, soloed: false, source: seg(false) }])).toBe(true);
  });
});

describe('nextFillIndex', () => {
  it('goes forward from the cursor first', () => {
    expect(nextFillIndex(new Set([0]), new Set(), 2, 6)).toBe(2);
    expect(nextFillIndex(new Set([0, 2]), new Set(), 2, 6)).toBe(3);
  });
  it('backfills earlier gaps once forward is exhausted', () => {
    expect(nextFillIndex(new Set([0, 3, 4, 5]), new Set(), 3, 6)).toBe(1);
  });
  it('skips errored indices', () => {
    expect(nextFillIndex(new Set([0]), new Set([2]), 2, 6)).toBe(3);
  });
  it('returns null when all indices are decoded or errored', () => {
    expect(nextFillIndex(new Set([0, 1, 2]), new Set([3, 4, 5]), 1, 6)).toBeNull();
  });
});
