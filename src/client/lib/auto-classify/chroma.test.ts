import { describe, expect, test } from 'vitest';
import {
  extractChromaSequence,
  packChroma,
  unpackChroma,
  CHROMA_FRAME_SIZE,
} from './chroma';

function sine(
  freqHz: number,
  durationSec: number,
  sampleRate: number,
): Float32Array {
  const n = Math.floor(durationSec * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return out;
}

describe('extractChromaSequence', () => {
  test('produces a non-empty sequence of 12-d vectors for 2s of audio', () => {
    const audio = sine(440, 2, 22050); // A4
    const seq = extractChromaSequence(audio, 22050);
    expect(seq.length).toBeGreaterThan(5);
    for (const v of seq) expect(v).toHaveLength(12);
  });

  test('peaks chroma bin 9 (A) for a 440 Hz tone', () => {
    const audio = sine(440, 2, 22050);
    const seq = extractChromaSequence(audio, 22050);
    const v = seq[Math.floor(seq.length / 2)];
    const maxBin = v.indexOf(Math.max(...v));
    expect(maxBin).toBe(9);
  });

  test('returns empty array when input is shorter than one frame', () => {
    const tiny = new Float32Array(CHROMA_FRAME_SIZE - 1);
    expect(extractChromaSequence(tiny, 22050)).toEqual([]);
  });
});

describe('packChroma / unpackChroma', () => {
  test('round-trips a chroma sequence', () => {
    const seq = [
      [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.05, 0.95],
      [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
      [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    ];
    const packed = packChroma(seq);
    expect(packed.byteLength).toBe(seq.length * 12 * 4);
    const unpacked = unpackChroma(packed);
    expect(unpacked).toHaveLength(seq.length);
    for (let i = 0; i < seq.length; i++) {
      for (let j = 0; j < 12; j++) {
        expect(unpacked[i][j]).toBeCloseTo(seq[i][j], 5);
      }
    }
  });

  test('packChroma throws on non-12-d row', () => {
    expect(() => packChroma([[1, 2, 3]])).toThrow(/row 0/);
  });

  test('unpackChroma throws on byteLength not a multiple of 48', () => {
    expect(() => unpackChroma(new Uint8Array(47))).toThrow(/byteLength/);
  });

  test('packChroma handles empty input', () => {
    const packed = packChroma([]);
    expect(packed.byteLength).toBe(0);
    expect(unpackChroma(packed)).toEqual([]);
  });
});
