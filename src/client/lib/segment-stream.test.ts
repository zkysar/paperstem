import { describe, expect, test } from 'vitest';
import {
  DEFAULT_SEGMENT_SEC,
  RESERVOIR_MAX_BYTES,
  contiguousFrontierSec,
  leadInTrimSamples,
  mixFrontierSec,
  planCbrByteRange,
  planSegments,
  segmentIndexAt,
  selectWindow,
} from './segment-stream';

describe('planSegments', () => {
  test('splits a duration into fixed segments, clamping the last', () => {
    const plan = planSegments(50, 20);
    expect(plan.count).toBe(3);
    expect(plan.segments).toEqual([
      { index: 0, startSec: 0, endSec: 20 },
      { index: 1, startSec: 20, endSec: 40 },
      { index: 2, startSec: 40, endSec: 50 },
    ]);
  });

  test('an exact multiple yields no zero-length trailing segment', () => {
    const plan = planSegments(40, 20);
    expect(plan.count).toBe(2);
    expect(plan.segments[1]).toEqual({ index: 1, startSec: 20, endSec: 40 });
  });

  test('uses index*seg boundaries so they do not drift on long files', () => {
    const plan = planSegments(1000, 0.1);
    expect(plan.segments[500].startSec).toBe(50);
  });

  test('defaults the segment length', () => {
    expect(planSegments(10).segmentSec).toBe(DEFAULT_SEGMENT_SEC);
  });

  test.each([0, -5, NaN, Infinity])('non-positive/non-finite duration → empty plan (%p)', (d) => {
    expect(planSegments(d as number, 20).count).toBe(0);
  });

  test('invalid segment length falls back to the default', () => {
    expect(planSegments(100, 0).segmentSec).toBe(DEFAULT_SEGMENT_SEC);
    expect(planSegments(100, -1).segmentSec).toBe(DEFAULT_SEGMENT_SEC);
  });
});

describe('segmentIndexAt', () => {
  const plan = planSegments(50, 20); // segments 0,1,2

  test('maps a time to its segment', () => {
    expect(segmentIndexAt(plan, 0)).toBe(0);
    expect(segmentIndexAt(plan, 19.9)).toBe(0);
    expect(segmentIndexAt(plan, 20)).toBe(1);
    expect(segmentIndexAt(plan, 45)).toBe(2);
  });

  test('clamps past-end and negative/non-finite times', () => {
    expect(segmentIndexAt(plan, 9999)).toBe(2);
    expect(segmentIndexAt(plan, -10)).toBe(0);
    expect(segmentIndexAt(plan, NaN)).toBe(0);
  });

  test('empty plan returns 0', () => {
    expect(segmentIndexAt(planSegments(0), 5)).toBe(0);
  });
});

describe('selectWindow', () => {
  const plan = planSegments(200, 20); // 10 segments, indices 0..9

  test('prioritises the current segment, then forward, then backward', () => {
    const sel = selectWindow(plan, 100, new Set(), { behindSec: 20, aheadSec: 40 });
    // playhead 100 → cur=5; window [80..140] → segments 4..7.
    expect(sel.needed).toEqual([4, 5, 6, 7]);
    expect(sel.toFetch).toEqual([5, 6, 7, 4]);
  });

  test('omits already-decoded segments from toFetch', () => {
    const sel = selectWindow(plan, 100, new Set([5, 6]), { behindSec: 20, aheadSec: 40 });
    expect(sel.toFetch).toEqual([7, 4]);
  });

  test('the current segment being decoded stays in needed but not toFetch', () => {
    const sel = selectWindow(plan, 100, new Set([5]), { behindSec: 20, aheadSec: 40 });
    expect(sel.needed).toContain(5);
    expect(sel.toFetch).not.toContain(5);
  });

  test('toFetch is always a subset of needed', () => {
    const sel = selectWindow(plan, 60, new Set([0, 9]), { behindSec: 20, aheadSec: 60 });
    const neededSet = new Set(sel.needed);
    expect(sel.toFetch.every((i) => neededSet.has(i))).toBe(true);
  });

  test('evicts decoded segments outside the window', () => {
    const sel = selectWindow(plan, 100, new Set([0, 1, 5, 9]), { behindSec: 20, aheadSec: 40 });
    expect(sel.toEvict).toEqual([0, 1, 9]);
  });

  test('clamps the window at the start of the file', () => {
    const sel = selectWindow(plan, 0, new Set(), { behindSec: 20, aheadSec: 40 });
    expect(sel.needed).toEqual([0, 1, 2]);
    expect(sel.toFetch).toEqual([0, 1, 2]);
  });

  test('clamps the window at the end of the file', () => {
    const sel = selectWindow(plan, 200, new Set(), { behindSec: 45, aheadSec: 40 });
    expect(sel.needed).toEqual([7, 8, 9]);
  });

  test('empty plan evicts everything and fetches nothing', () => {
    const sel = selectWindow(planSegments(0), 5, new Set([0, 1]));
    expect(sel).toEqual({ needed: [], toFetch: [], toEvict: [0, 1] });
  });
});

describe('contiguousFrontierSec', () => {
  const plan = planSegments(100, 20); // segments 0..4, ends at 20,40,60,80,100

  test('returns the end of an unbroken decoded run from the index', () => {
    expect(contiguousFrontierSec(plan, new Set([0, 1, 2]), 0)).toBe(60);
  });

  test('stops at the first gap', () => {
    expect(contiguousFrontierSec(plan, new Set([0, 1, 3, 4]), 0)).toBe(40);
  });

  test('a decoded run is measured from the requested start index', () => {
    expect(contiguousFrontierSec(plan, new Set([2, 3]), 2)).toBe(80);
  });

  test('an undecoded start index has nothing buffered → its start time', () => {
    expect(contiguousFrontierSec(plan, new Set([0, 1]), 3)).toBe(60);
  });

  test('a fully decoded file reaches the true duration on the last segment', () => {
    expect(contiguousFrontierSec(plan, new Set([0, 1, 2, 3, 4]), 0)).toBe(100);
  });

  test('empty plan returns 0', () => {
    expect(contiguousFrontierSec(planSegments(0), new Set(), 0)).toBe(0);
  });
});

describe('mixFrontierSec', () => {
  const plan = planSegments(100, 20);

  test('is the minimum frontier across active stems', () => {
    const fast = new Set([0, 1, 2, 3]); // → 80
    const slow = new Set([0, 1]); // → 40
    expect(mixFrontierSec(plan, [fast, slow], 0)).toBe(40);
  });

  test('a single stem gates on itself', () => {
    expect(mixFrontierSec(plan, [new Set([0, 1, 2])], 0)).toBe(60);
  });

  test('no active stems (all muted) → full duration, plays freely', () => {
    expect(mixFrontierSec(plan, [], 0)).toBe(100);
  });

  test('a stem with a gap at the playhead pins the frontier to its start', () => {
    const ready = new Set([0, 1, 2]);
    const stalled = new Set([0]);
    expect(mixFrontierSec(plan, [ready, stalled], 1)).toBe(20);
  });
});

describe('planCbrByteRange', () => {
  // 1000 KB file, 100 s, 10 B header → 999 KB audio, ~999 B/s.
  const base = { durationSec: 100, fileByteLength: 1000 + 10, headerBytes: 10 };

  test('first segment starts at the header with no lead-in', () => {
    const r = planCbrByteRange({ startSec: 0, endSec: 20, ...base });
    expect(r?.start).toBe(10);
  });

  test('a middle segment includes the reservoir lead-in', () => {
    const r = planCbrByteRange({ startSec: 50, endSec: 70, ...base, leadInBytes: 50 });
    const bytesPerSec = 1000 / 100;
    const rawStart = 10 + Math.floor(50 * bytesPerSec);
    expect(r?.start).toBe(rawStart - 50);
  });

  test('lead-in never reads before the header', () => {
    const r = planCbrByteRange({ startSec: 0.5, endSec: 20, ...base, leadInBytes: RESERVOIR_MAX_BYTES });
    expect(r?.start).toBe(10);
  });

  test('the last segment runs to EOF to capture the encoder tail', () => {
    const r = planCbrByteRange({ startSec: 80, endSec: 100, ...base });
    expect(r?.end).toBe(base.fileByteLength);
  });

  test('a middle segment ends before EOF', () => {
    const r = planCbrByteRange({ startSec: 20, endSec: 40, ...base });
    expect(r?.end).toBeLessThan(base.fileByteLength);
  });

  test('end is always greater than start', () => {
    const r = planCbrByteRange({ startSec: 20, endSec: 40, ...base });
    expect(r!.end).toBeGreaterThan(r!.start);
  });

  test.each([
    { durationSec: 0, fileByteLength: 1000 },
    { durationSec: 100, fileByteLength: 0 },
    { durationSec: 100, fileByteLength: 5, headerBytes: 10 },
  ])('invalid inputs return null (%o)', (bad) => {
    expect(planCbrByteRange({ startSec: 0, endSec: 20, ...bad })).toBeNull();
  });
});

describe('leadInTrimSamples', () => {
  test('trims the lead-in plus the decoder priming', () => {
    // decoded started 0.5 s early at 44.1 kHz → 22050 lead-in samples, +529 priming.
    expect(leadInTrimSamples(49.5, 50, 44100, 529)).toBe(22050 + 529);
  });

  test('first segment (no lead-in, no priming) trims nothing', () => {
    expect(leadInTrimSamples(0, 0, 44100, 0)).toBe(0);
  });

  test('never returns negative when the decoded start is past the segment', () => {
    expect(leadInTrimSamples(51, 50, 44100, 0)).toBe(0);
  });

  test('invalid sample rate → 0', () => {
    expect(leadInTrimSamples(49.5, 50, 0)).toBe(0);
  });
});
