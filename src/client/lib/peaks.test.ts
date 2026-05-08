import { describe, it, expect, beforeEach } from 'vitest';
import {
  computePeaks,
  loadCachedPeaks,
  saveCachedPeaks,
  PEAK_BINS,
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
