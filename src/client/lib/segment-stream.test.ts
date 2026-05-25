import { describe, it, expect } from 'vitest';
import { planSegments, LEAD_IN_BYTES } from './segment-stream';

describe('planSegments', () => {
  it('splits a CBR file into ~segSec windows by linear byte interpolation', () => {
    // 1,000,000 bytes, 100 s, 20 s segments -> 5 segments of 200,000 bytes.
    const segs = planSegments(1_000_000, 100, 20);
    expect(segs).toHaveLength(5);
    expect(segs[0]).toMatchObject({ index: 0, byteStart: 0, byteEnd: 200_000, leadInBytes: 0 });
    expect(segs[1]).toMatchObject({ index: 1, byteStart: 200_000, byteEnd: 400_000, leadInBytes: LEAD_IN_BYTES });
    expect(segs[4].byteEnd).toBe(1_000_000); // last segment runs to EOF
  });

  it('produces a single segment when the file is shorter than one window', () => {
    const segs = planSegments(50_000, 5, 20);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ index: 0, byteStart: 0, byteEnd: 50_000, leadInBytes: 0 });
  });

  it('clamps the fetch start by lead-in but never below 0', () => {
    const segs = planSegments(1_000_000, 100, 20);
    expect(segs[1].fetchStart).toBe(200_000 - LEAD_IN_BYTES);
    expect(segs[0].fetchStart).toBe(0);
  });

  it('returns [] when totalBytes is 0', () => {
    expect(planSegments(0, 100, 20)).toEqual([]);
  });

  it('returns [] when totalSec is 0', () => {
    expect(planSegments(1000, 0, 20)).toEqual([]);
  });
});
