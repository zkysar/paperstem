import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { isMp3, frameLength, lastCompleteFrameEnd, firstFrameStart, sampleRateOf } from './mp3-frames';

// MPEG1 Layer III, 64 kbps, 44.1 kHz, no padding -> 4-byte header 0xFF 0xFB 0x50 0x00
const HEADER_64K = [0xff, 0xfb, 0x50, 0x00]; // brIdx=5(64k), srIdx=0(44.1k), pad=0
function frame(lenBytes: number, pad = 0): Uint8Array {
  const b = new Uint8Array(lenBytes);
  b[0] = 0xff; b[1] = 0xfb; b[2] = 0x50 | (pad << 1); b[3] = 0x00;
  return b;
}

describe('frameLength', () => {
  it('computes MPEG1 L3 64k/44.1k frame size', () => {
    expect(frameLength(new Uint8Array(HEADER_64K), 0)).toBe(208); // floor(144*64000/44100)
  });
  it('adds 1 byte when padding bit set', () => {
    const h = [...HEADER_64K]; h[2] |= 0x02;
    expect(frameLength(new Uint8Array(h), 0)).toBe(209);
  });
  it('returns 0 when sync word absent', () => {
    expect(frameLength(new Uint8Array([0, 0, 0, 0]), 0)).toBe(0);
  });
});

describe('isMp3', () => {
  it('true on a buffer starting with a valid frame', () => {
    expect(isMp3(frame(208))).toBe(true);
  });
  it('true when an ID3v2 tag precedes the first frame', () => {
    const id3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 10, ...new Array(10).fill(0)]);
    const buf = new Uint8Array([...id3, ...frame(208)]);
    expect(isMp3(buf)).toBe(true);
  });
  it('false on a WAV (RIFF) header', () => {
    expect(isMp3(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe(false);
  });
});

describe('lastCompleteFrameEnd', () => {
  it('returns the byte offset after the last whole frame, ignoring a partial tail', () => {
    const buf = new Uint8Array([...frame(208), ...frame(208), ...new Array(50).fill(0)]);
    expect(lastCompleteFrameEnd(buf)).toBe(416);
  });
});

describe('firstFrameStart', () => {
  it('skips junk/lead-in bytes to the first sync word', () => {
    const buf = new Uint8Array([0x11, 0x22, ...frame(208)]);
    expect(firstFrameStart(buf)).toBe(2);
  });
});

describe('sampleRateOf', () => {
  it('returns 44100 for the standard 44.1 kHz header', () => {
    expect(sampleRateOf(new Uint8Array(HEADER_64K))).toBe(44100);
  });
  it('returns 48000 for srIdx=1 (byte2 = 0x54)', () => {
    // byte2: brIdx=5(64k) -> 0x50, srIdx=1(48k) -> (1 << 2) = 0x04, so 0x50 | 0x04 = 0x54
    const h = [0xff, 0xfb, 0x54, 0x00];
    expect(sampleRateOf(new Uint8Array(h))).toBe(48000);
  });
  it('returns 0 for an invalid header', () => {
    expect(sampleRateOf(new Uint8Array([0, 0, 0, 0]))).toBe(0);
  });
  it('defaults i to the first frame (skips junk-prefixed bytes)', () => {
    const buf = new Uint8Array([0x11, 0x22, ...frame(208)]);
    expect(sampleRateOf(buf)).toBe(44100);
  });
});

describe('real fixture', () => {
  it('bass.mp3 is recognized as MP3', () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, '../../../assets/dev-seed/bass.mp3')));
    expect(isMp3(bytes)).toBe(true);
  });
  it('lastCompleteFrameEnd on 40KB slice is within [39792, 40000]', () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, '../../../assets/dev-seed/bass.mp3')));
    const end = lastCompleteFrameEnd(bytes.subarray(0, 40000));
    expect(end).toBeGreaterThanOrEqual(39792);
    expect(end).toBeLessThanOrEqual(40000);
  });
});
