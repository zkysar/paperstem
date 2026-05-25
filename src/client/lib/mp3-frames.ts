// Pure-JS MPEG-1 Audio Layer III frame parsing. No dependencies, no Web Audio.
// We only ever handle our own re-encoded output (mono 64 kbps CBR, 44.1 kHz),
// but the tables cover MPEG-1 L3 generally so the parser is robust to other
// CBR MP3 uploads. A frame-aligned prefix of an MP3 is itself a valid MP3.

const MPEG1_L3_BITRATES = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
]; // kbps, indexed by the 4-bit bitrate field
const SAMPLE_RATES = [44100, 48000, 32000, 0]; // indexed by the 2-bit field

/** Length in bytes of the frame whose header starts at `i`, or 0 if not a valid MPEG-1 L3 frame header. */
export function frameLength(b: Uint8Array, i: number): number {
  if (i + 4 > b.length) return 0;
  // Frame sync: 11 bits set. Byte1 high 3 bits = 111; require MPEG1 (bits 4-3 = 11) Layer III (bits 2-1 = 01).
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return 0;
  if ((b[i + 1] & 0x18) !== 0x18) return 0; // MPEG version 1
  if ((b[i + 1] & 0x06) !== 0x02) return 0; // Layer III
  const brIdx = (b[i + 2] & 0xf0) >> 4;
  const srIdx = (b[i + 2] & 0x0c) >> 2;
  const pad = (b[i + 2] & 0x02) >> 1;
  const br = MPEG1_L3_BITRATES[brIdx] * 1000;
  const sr = SAMPLE_RATES[srIdx];
  if (!br || !sr) return 0;
  return Math.floor((144 * br) / sr) + pad;
}

/**
 * Offset of the first valid frame header, skipping any ID3v2 tag or junk.
 * If no valid frame header is reachable (truncated/corrupt input), returns the
 * post-ID3 scan start — NOT a guaranteed frame boundary. Callers must validate
 * with `frameLength`/`sampleRateOf` (both return 0 there), as `isMp3` does.
 */
export function firstFrameStart(b: Uint8Array): number {
  let start = 0;
  // Skip an ID3v2 tag if present ("ID3" + version + flags + 4 syncsafe size bytes).
  if (b.length >= 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    const size =
      ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    start = 10 + size;
  }
  for (let i = start; i + 4 <= b.length; i++) {
    if (frameLength(b, i) > 0) return i;
  }
  return start; // no sync found; not a valid frame start (see doc above)
}

/** True if the buffer looks like an MP3 (a valid frame header is reachable). */
export function isMp3(b: Uint8Array): boolean {
  return frameLength(b, firstFrameStart(b)) > 0;
}

/** Byte offset just past the last *complete* frame; trims a partial trailing frame. */
export function lastCompleteFrameEnd(b: Uint8Array): number {
  let i = firstFrameStart(b);
  let end = i;
  while (i + 4 <= b.length) {
    const len = frameLength(b, i);
    if (len === 0) {
      i++;
      continue;
    }
    if (i + len > b.length) break; // partial trailing frame
    end = i + len;
    i += len;
  }
  return end;
}

/**
 * Sample rate in Hz of the frame whose header starts at `i`.
 * If `i` is omitted, uses `firstFrameStart(b)`.
 * Returns 0 if not a valid MPEG-1 L3 frame header.
 */
export function sampleRateOf(b: Uint8Array, i?: number): number {
  const offset = i !== undefined ? i : firstFrameStart(b);
  if (offset + 4 > b.length) return 0;
  if (b[offset] !== 0xff || (b[offset + 1] & 0xe0) !== 0xe0) return 0;
  if ((b[offset + 1] & 0x18) !== 0x18) return 0; // MPEG version 1
  if ((b[offset + 1] & 0x06) !== 0x02) return 0; // Layer III
  const srIdx = (b[offset + 2] & 0x0c) >> 2;
  return SAMPLE_RATES[srIdx];
}
