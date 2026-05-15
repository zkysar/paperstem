// Server-side mirror of the chroma pack/unpack helpers in
// src/client/lib/auto-classify/chroma.ts. The layout is identical
// (row-major little-endian float32, 12 columns) so blobs produced by the
// client and stored in `song_fingerprints.fingerprint_blob` round-trip
// through this module without further conversion.
//
// Duplicated rather than imported because:
//   - Phase 3 implementer is constrained from modifying src/client/.
//   - The client module imports `meyda` at top level; pulling it into the
//     server bundle would drag a browser-oriented dep into Node.
//   - The pack/unpack functions are ~20 lines and trivially symmetric;
//     a shared module under src/shared/auto-classify/ is the cleaner
//     long-term home and is left as future work for Phase 4 if/when the
//     extraction code is consolidated.

export const CHROMA_DIMS = 12;
const FLOAT32_BYTES = 4;
const ROW_BYTES = CHROMA_DIMS * FLOAT32_BYTES;

/**
 * Pack a chroma sequence into a Uint8Array for storage as `fingerprint_blob`.
 * Layout: little-endian float32 array, row-major. Length = numFrames * 12.
 */
export function packChroma(seq: number[][]): Uint8Array {
  const buf = new ArrayBuffer(seq.length * ROW_BYTES);
  const view = new DataView(buf);
  for (let i = 0; i < seq.length; i++) {
    const row = seq[i];
    if (row.length !== CHROMA_DIMS) {
      throw new Error(
        `packChroma: row ${i} has length ${row.length}, expected ${CHROMA_DIMS}`,
      );
    }
    for (let j = 0; j < CHROMA_DIMS; j++) {
      view.setFloat32((i * CHROMA_DIMS + j) * FLOAT32_BYTES, row[j], true);
    }
  }
  return new Uint8Array(buf);
}

/**
 * Unpack a fingerprint blob back into a chroma sequence. Accepts either a
 * Uint8Array or a Node Buffer (which extends Uint8Array, so it works as-is).
 */
export function unpackChroma(buf: Uint8Array): number[][] {
  if (buf.byteLength % ROW_BYTES !== 0) {
    throw new Error(
      `unpackChroma: byteLength ${buf.byteLength} is not a multiple of ${ROW_BYTES}`,
    );
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numFrames = buf.byteLength / ROW_BYTES;
  const out: number[][] = [];
  for (let i = 0; i < numFrames; i++) {
    const v: number[] = [];
    for (let j = 0; j < CHROMA_DIMS; j++) {
      v.push(view.getFloat32((i * CHROMA_DIMS + j) * FLOAT32_BYTES, true));
    }
    out.push(v);
  }
  return out;
}
