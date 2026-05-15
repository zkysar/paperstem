import { describe, it, expect } from 'vitest';
import {
  matchSegmentToCorpus,
  _internal,
  type CorpusEntry,
} from './matcher.js';
import { packChroma } from './chroma-blob.js';
import { CONFIDENCE_HIGH, CONFIDENCE_LOW } from './naming.js';

const make = (vec: number[]) => Array(20).fill(vec);

function corpusFromChroma(
  entries: { song_id: string; song_name: string; chroma: number[][]; duration_ms?: number }[],
): CorpusEntry[] {
  return entries.map((e) => ({
    song_id: e.song_id,
    song_name: e.song_name,
    fingerprint_blob: Buffer.from(packChroma(e.chroma)),
    duration_ms: e.duration_ms ?? e.chroma.length * 93,
  }));
}

describe('matchSegmentToCorpus', () => {
  const corpus = corpusFromChroma([
    { song_id: 'a', song_name: 'A', chroma: make([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) },
    { song_id: 'b', song_name: 'B', chroma: make([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) },
  ]);

  it('matches the closer fingerprint', () => {
    const probe = make([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const out = matchSegmentToCorpus(probe, corpus);
    expect(out.match?.song_id).toBe('a');
  });

  it('returns no match when corpus is empty', () => {
    const out = matchSegmentToCorpus(
      make([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      [],
    );
    expect(out.match).toBeNull();
    expect(out.confidence).toBe(0);
  });

  it('produces a confidence between 0 and 1', () => {
    const out = matchSegmentToCorpus(
      make([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      corpus,
    );
    expect(out.confidence).toBeGreaterThanOrEqual(0);
    expect(out.confidence).toBeLessThanOrEqual(1);
  });

  it('an identical probe gets high confidence', () => {
    const probe = make([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const out = matchSegmentToCorpus(probe, corpus);
    expect(out.confidence).toBeGreaterThan(CONFIDENCE_HIGH);
    expect(out.raw_distance).toBeLessThan(0.07);
  });

  it('skips corpus entries whose duration differs by more than the tolerance', () => {
    // Corpus entry's stored duration is far from the probe's implied duration.
    const farCorpus: CorpusEntry[] = [
      {
        song_id: 'a',
        song_name: 'A',
        fingerprint_blob: Buffer.from(
          packChroma(make([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
        ),
        duration_ms: 600_000, // 10 minutes
      },
    ];
    const probe = make([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // ~1.8s
    const out = matchSegmentToCorpus(probe, farCorpus, { durationToleranceMs: 30_000 });
    expect(out.match).toBeNull();
  });
});

describe('distanceToConfidence calibration', () => {
  it('maps distance 0.05 above CONFIDENCE_HIGH', () => {
    expect(_internal.distanceToConfidence(0.05)).toBeGreaterThan(CONFIDENCE_HIGH);
  });

  it('maps distance 0.07 at or above CONFIDENCE_HIGH', () => {
    expect(_internal.distanceToConfidence(0.07)).toBeGreaterThanOrEqual(CONFIDENCE_HIGH);
  });

  it('maps distance 0.11 at or above CONFIDENCE_LOW', () => {
    expect(_internal.distanceToConfidence(0.11)).toBeGreaterThanOrEqual(CONFIDENCE_LOW);
  });

  it('maps distance 0.15 below CONFIDENCE_LOW', () => {
    expect(_internal.distanceToConfidence(0.15)).toBeLessThan(CONFIDENCE_LOW);
  });

  it('is monotonically decreasing in distance', () => {
    const distances = [0, 0.05, 0.07, 0.09, 0.11, 0.15, 0.3];
    let prev = Infinity;
    for (const d of distances) {
      const c = _internal.distanceToConfidence(d);
      expect(c).toBeLessThan(prev);
      prev = c;
    }
  });
});
