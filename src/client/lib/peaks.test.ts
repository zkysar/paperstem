import { describe, it, expect, beforeEach } from 'vitest';
import {
  computePeaks,
  loadCachedPeaks,
  saveCachedPeaks,
  PEAK_BINS,
  encodePeaks,
  decodePeaks,
  thumbPeaksFromWire,
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

  it('weights sustained energy over lone spikes with mode "rms"', () => {
    // Bin 0 is near-silent but for one full-scale sample; bin 1 is a steady
    // half-scale tone. The default peak mode ranks bin 0 highest (its lone
    // spike); RMS ranks bin 1 highest (it carries far more energy). This is the
    // difference that stops a loud master's thumbnail from saturating.
    const spike = new Array(100).fill(0);
    spike[0] = 1;
    const sustained = new Array(100).fill(0.5);
    const samples = [...spike, ...sustained];
    const peak = computePeaks(makeBuffer([samples]), 2);
    expect(peak[0]).toBeGreaterThan(peak[1]);
    const rms = computePeaks(makeBuffer([samples]), 2, { mode: 'rms' });
    expect(rms[1]).toBeGreaterThan(rms[0]);
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
    localStorage.setItem('paperstem:peaks:v2:bad', 'not,a,number');
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

describe('thumbPeaksFromWire', () => {
  it('returns null for null/empty/legacy input', () => {
    expect(thumbPeaksFromWire(null)).toBeNull();
    expect(thumbPeaksFromWire(undefined)).toBeNull();
    expect(thumbPeaksFromWire('')).toBeNull();
    // Legacy bare CSV (v1) is rejected by decodePeaks.
    expect(thumbPeaksFromWire('0,128,255')).toBeNull();
  });

  it('decodes and normalizes a short wire string', () => {
    // Max of the input is 0.4 → after normalize the largest bin is 1.
    const peaks = thumbPeaksFromWire(encodePeaks([0.1, 0.2, 0.4]));
    expect(peaks).not.toBeNull();
    expect(peaks!).toHaveLength(3);
    expect(Math.max(...peaks!)).toBeCloseTo(1, 5);
    expect(peaks![0]).toBeCloseTo(0.25, 1);
  });

  it('downsamples a high-resolution envelope to at most PEAK_BINS', () => {
    const raw = new Array(2000).fill(0).map((_, i) => (i % 50) / 50);
    const peaks = thumbPeaksFromWire(encodePeaks(raw));
    expect(peaks).not.toBeNull();
    expect(peaks!.length).toBe(PEAK_BINS);
    // The result is normalized, so the loudest bucket is always 1.
    expect(Math.max(...peaks!)).toBeCloseTo(1, 5);
  });

  it('reveals loudness density that max-pooling would flatten into a sausage', () => {
    // Both halves peak at full scale, so the old max-pooling rendered every
    // bucket at 1.0 (the "sausage"). The first half is sparse (one spike per
    // window) and the second is dense (a spike every other sample), so the RMS
    // envelope must render the first half visibly shorter than the second.
    const raw = new Array(2000).fill(0);
    for (let i = 0; i < 2000; i++) {
      raw[i] = i < 1000 ? (i % 18 === 0 ? 1 : 0) : i % 2 === 0 ? 1 : 0;
    }
    const peaks = thumbPeaksFromWire(encodePeaks(raw))!;
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const sparseAvg = avg(peaks.slice(5, 45));
    const denseAvg = avg(peaks.slice(65, 105));
    expect(denseAvg).toBeGreaterThan(sparseAvg * 1.5);
  });

  it('keeps the source length when shorter than PEAK_BINS', () => {
    const raw = [0.2, 0.4, 0.6, 0.8, 1];
    const peaks = thumbPeaksFromWire(encodePeaks(raw));
    expect(peaks!).toHaveLength(raw.length);
  });
});
