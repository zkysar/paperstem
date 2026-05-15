import { describe, expect, it } from 'vitest';
import { sliceChromaForSection } from './backfill-fingerprints.js';

const C = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const D = [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];

function chromaSeq(vec: number[], n: number): number[][] {
  return Array.from({ length: n }, () => [...vec]);
}

describe('sliceChromaForSection', () => {
  it('returns null when no music segment overlaps', () => {
    const segs = [
      { start_ms: 0, end_ms: 1000, segment_type: 'chatter' },
      { start_ms: 1000, end_ms: 2000, segment_type: 'music', chroma: chromaSeq(C, 10) },
    ];
    expect(sliceChromaForSection(segs, 5000, 6000)).toBeNull();
  });

  it('returns null on inverted range', () => {
    const segs = [
      { start_ms: 0, end_ms: 10000, segment_type: 'music', chroma: chromaSeq(C, 100) },
    ];
    expect(sliceChromaForSection(segs, 5000, 5000)).toBeNull();
    expect(sliceChromaForSection(segs, 6000, 5000)).toBeNull();
  });

  it('slices proportionally to the overlap with the chosen music segment', () => {
    const segs = [
      { start_ms: 0, end_ms: 10000, segment_type: 'music', chroma: chromaSeq(C, 100) },
    ];
    // Section spans 4000–6000ms of a 0–10000ms segment with 100 frames
    // → frames [40, 60).
    const slice = sliceChromaForSection(segs, 4000, 6000);
    expect(slice).not.toBeNull();
    expect(slice!).toHaveLength(20);
    for (const row of slice!) expect(row).toEqual(C);
  });

  it('picks the music segment with the largest overlap when multiple exist', () => {
    const segs = [
      // Big chroma in C; partial overlap (1500ms with section 2000-7000).
      { start_ms: 500, end_ms: 3500, segment_type: 'music', chroma: chromaSeq(C, 30) },
      // Smaller chroma in D, but full overlap (4000-7000 inside section).
      { start_ms: 4000, end_ms: 7000, segment_type: 'music', chroma: chromaSeq(D, 30) },
    ];
    const slice = sliceChromaForSection(segs, 2000, 7000);
    expect(slice).not.toBeNull();
    // The D-segment had 3000ms overlap (larger than 1500ms of the C one), so
    // the slice rows should be D.
    for (const row of slice!) expect(row).toEqual(D);
  });

  it('skips music segments without chroma payloads', () => {
    const segs = [
      { start_ms: 0, end_ms: 5000, segment_type: 'music' },
      { start_ms: 5000, end_ms: 10000, segment_type: 'music', chroma: chromaSeq(C, 50) },
    ];
    const slice = sliceChromaForSection(segs, 0, 10000);
    expect(slice).not.toBeNull();
    for (const row of slice!) expect(row).toEqual(C);
  });
});
