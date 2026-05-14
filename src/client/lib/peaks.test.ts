import { describe, it, expect, beforeEach } from 'vitest';
import {
  computePeaks,
  loadCachedPeaks,
  saveCachedPeaks,
  PEAK_BINS,
  encodePeaks,
  decodePeaks,
} from './peaks';

function makeBuffer(samples: number[][], sampleRate = 44100): AudioBuffer {
  const channels = samples;
  const length = channels[0].length;
  const data = channels.map((c) => Float32Array.from(c));
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData(i: number) {
      return data[i];
    },
  } as unknown as AudioBuffer;
}

describe('computePeaks', () => {
  it('returns the requested number of bins', () => {
    const buf = makeBuffer([new Array(1024).fill(0.5)]);
    expect(computePeaks(buf, 32)).toHaveLength(32);
  });

  it('defaults to PEAK_BINS', () => {
    const buf = makeBuffer([new Array(1024).fill(0.5)]);
    expect(computePeaks(buf)).toHaveLength(PEAK_BINS);
  });

  it('normalizes max amplitude to 1.0', () => {
    const samples = new Array(2048).fill(0).map((_, i) => (i < 1024 ? 0.25 : 0.4));
    const peaks = computePeaks(makeBuffer([samples]), 8);
    const max = Math.max(...peaks);
    expect(max).toBeCloseTo(1, 5);
  });

  it('takes max abs across channels', () => {
    const left = [0.1, 0.1, 0.1, 0.1];
    const right = [0.1, 0.9, 0.1, 0.1];
    const peaks = computePeaks(makeBuffer([left, right]), 4);
    // Bin 1 is dominated by 0.9 → max post-normalize.
    expect(peaks[1]).toBeCloseTo(1, 5);
    expect(peaks[0]).toBeLessThan(0.5);
  });

  it('returns all-zeros for empty buffer', () => {
    const peaks = computePeaks(makeBuffer([new Array(0)]), 4);
    expect(peaks).toEqual([0, 0, 0, 0]);
  });

  it('returns raw absolute amplitudes when normalize: false', () => {
    // With normalization off, a buffer that maxes at 0.4 should produce a
    // peak < 1 — this is what lets WaveSurfer's `normalize` option meaningfully
    // distinguish global from per-track at render time.
    const samples = new Array(2048).fill(0).map((_, i) => (i < 1024 ? 0.25 : 0.4));
    const peaks = computePeaks(makeBuffer([samples]), 8, { normalize: false });
    const max = Math.max(...peaks);
    expect(max).toBeCloseTo(0.4, 5);
    expect(Math.min(...peaks)).toBeCloseTo(0.25, 5);
  });
});

describe('peaks cache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips through localStorage with bounded loss', () => {
    const original = [0, 0.25, 0.5, 0.75, 1];
    saveCachedPeaks('stem-1', original);
    const loaded = loadCachedPeaks('stem-1');
    expect(loaded).not.toBeNull();
    expect(loaded!).toHaveLength(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(loaded![i]).toBeCloseTo(original[i], 2);
    }
  });

  it('returns null for unknown stem', () => {
    expect(loadCachedPeaks('does-not-exist')).toBeNull();
  });

  it('clamps out-of-range values when saving', () => {
    saveCachedPeaks('stem-2', [-1, 0.5, 2]);
    const loaded = loadCachedPeaks('stem-2');
    expect(loaded![0]).toBeCloseTo(0, 5);
    expect(loaded![1]).toBeCloseTo(0.5, 2);
    expect(loaded![2]).toBeCloseTo(1, 5);
  });

  it('returns null on malformed stored data', () => {
    localStorage.setItem('paperstem:peaks:v1:bad', 'not,a,number');
    expect(loadCachedPeaks('bad')).toBeNull();
  });
});

describe('encodePeaks / decodePeaks (wire format)', () => {
  it('emits a v2: prefix', () => {
    expect(encodePeaks([0, 0.5, 1])).toMatch(/^v2:/);
  });

  it('round-trips with bounded loss', () => {
    const original = [0, 0.25, 0.5, 0.75, 1];
    const encoded = encodePeaks(original);
    const decoded = decodePeaks(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!).toHaveLength(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(decoded![i]).toBeCloseTo(original[i], 2);
    }
  });

  it('returns null for empty input', () => {
    expect(decodePeaks('')).toBeNull();
  });

  it('returns null on malformed input', () => {
    expect(decodePeaks('v2:not,numbers')).toBeNull();
  });

  it('rejects legacy bare-CSV (v1) so the Track backfill rewrites it as v2', () => {
    // Pre-fix peaks were stored as bare CSV with values pre-normalized
    // per-stem, which silently no-op'd the global/per-track toggle. Returning
    // null here makes App treat the stem as having no precomputed peaks, so
    // WaveSurfer decodes the audio and Track.tsx's backfill writes fresh v2
    // peaks to the server.
    expect(decodePeaks('0,64,128,255')).toBeNull();
  });

  it('clamps out-of-range values when encoding', () => {
    const encoded = encodePeaks([-0.5, 0.5, 1.5]);
    const decoded = decodePeaks(encoded);
    expect(decoded![0]).toBeCloseTo(0, 5);
    expect(decoded![1]).toBeCloseTo(0.5, 2);
    expect(decoded![2]).toBeCloseTo(1, 5);
  });
});
