// Chroma feature extraction over mono Float32 PCM audio.
//
// Outputs a frame-rate sequence of 12-D vectors (one per FFT frame). The
// matcher (server-side, Stage 2) uses these as song fingerprints. This is
// the same approach validated in scripts/poc/spike-chroma.ts (2.4× ratio of
// cross-song to same-song DTW distance on real audio).
import Meyda from 'meyda';

export const CHROMA_FRAME_SIZE = 4096; // ~186ms at 22.05kHz
export const CHROMA_HOP_SIZE = 2048; // ~93ms hop
export const CHROMA_SAMPLE_RATE = 22050;
// Bump whenever the chroma extraction algorithm changes. Server matches on
// this in the idempotency key for `classification_runs` and `song_fingerprints`.
export const FINGERPRINT_VERSION = 1;

/**
 * Compute a frame-rate chroma sequence over a mono Float32 audio buffer.
 * Output is a sequence of 12-D vectors. Meyda's `chroma` feature uses the
 * standard C-major chromagram order: index 0 = C, 1 = C#, …, 9 = A, …, 11 = B.
 *
 * Frame-rate (rather than beat-synchronous) chroma is more robust to bad
 * beat tracking; DTW already handles tempo differences across renditions.
 */
export function extractChromaSequence(
  audio: Float32Array,
  sampleRate: number = CHROMA_SAMPLE_RATE,
): number[][] {
  if (audio.length < CHROMA_FRAME_SIZE) return [];
  const seq: number[][] = [];
  for (let i = 0; i + CHROMA_FRAME_SIZE <= audio.length; i += CHROMA_HOP_SIZE) {
    const frame = audio.subarray(i, i + CHROMA_FRAME_SIZE);
    const features = Meyda.extract('chroma', frame, {
      sampleRate,
      bufferSize: CHROMA_FRAME_SIZE,
    }) as number[];
    seq.push(Array.from(features));
  }
  return seq;
}

/** Pack a chroma sequence into a Uint8Array for storage as `fingerprint_blob`.
 * Layout: little-endian float32 array, row-major. Length = numFrames * 12.
 *
 * Returns Uint8Array (rather than Node Buffer) so this module compiles for
 * both the browser and Node bundles. Server code converts to a Buffer at the
 * DB write boundary.
 */
export function packChroma(seq: number[][]): Uint8Array {
  const buf = new ArrayBuffer(seq.length * 12 * 4);
  const view = new DataView(buf);
  for (let i = 0; i < seq.length; i++) {
    const row = seq[i];
    if (row.length !== 12) {
      throw new Error(
        `packChroma: row ${i} has length ${row.length}, expected 12`,
      );
    }
    for (let j = 0; j < 12; j++) {
      view.setFloat32((i * 12 + j) * 4, row[j], true);
    }
  }
  return new Uint8Array(buf);
}

export function unpackChroma(buf: Uint8Array): number[][] {
  if (buf.byteLength % (12 * 4) !== 0) {
    throw new Error(
      `unpackChroma: byteLength ${buf.byteLength} is not a multiple of 48`,
    );
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numFrames = buf.byteLength / (12 * 4);
  const out: number[][] = [];
  for (let i = 0; i < numFrames; i++) {
    const v: number[] = [];
    for (let j = 0; j < 12; j++) {
      v.push(view.getFloat32((i * 12 + j) * 4, true));
    }
    out.push(v);
  }
  return out;
}
