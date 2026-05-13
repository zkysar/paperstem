import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCuePoints } from './wav-cue.js';

type WavOpts = {
  cueSampleOffsets: number[];
  reservedEmptySlots?: number;
  includeCueChunk?: boolean;
  dataBytes?: number;
};

function buildWav(opts: WavOpts): Buffer {
  const includeCue = opts.includeCueChunk ?? true;
  const reserved = opts.reservedEmptySlots ?? 0;
  const totalCues = opts.cueSampleOffsets.length + reserved;

  const chunks: Buffer[] = [];

  if (includeCue) {
    const cueBody = Buffer.alloc(4 + totalCues * 24);
    cueBody.writeUInt32LE(totalCues, 0);
    let off = 4;
    for (const sampleOff of opts.cueSampleOffsets) {
      cueBody.writeUInt32LE(0, off);
      cueBody.writeUInt32LE(0, off + 4);
      cueBody.write('data', off + 8, 4, 'ascii');
      cueBody.writeUInt32LE(0, off + 12);
      cueBody.writeUInt32LE(0, off + 16);
      cueBody.writeUInt32LE(sampleOff, off + 20);
      off += 24;
    }
    for (let i = 0; i < reserved; i++) {
      cueBody.writeUInt32LE(0, off + 20);
      off += 24;
    }
    const cueHdr = Buffer.alloc(8);
    cueHdr.write('cue ', 0, 4, 'ascii');
    cueHdr.writeUInt32LE(cueBody.length, 4);
    chunks.push(cueHdr, cueBody);
  }

  const fmt = Buffer.alloc(8 + 16);
  fmt.write('fmt ', 0, 4, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(44100, 12);
  fmt.writeUInt32LE(88200, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  chunks.push(fmt);

  const dataBytes = opts.dataBytes ?? 0;
  const data = Buffer.alloc(8 + dataBytes);
  data.write('data', 0, 4, 'ascii');
  data.writeUInt32LE(dataBytes, 4);
  chunks.push(data);

  const payload = Buffer.concat(chunks);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 4, 'ascii');
  riff.writeUInt32LE(4 + payload.length, 4);
  riff.write('WAVE', 8, 4, 'ascii');
  return Buffer.concat([riff, payload]);
}

function writeTempWav(buf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'wav-cue-'));
  const path = join(dir, 'test.wav');
  writeFileSync(path, buf);
  return path;
}

describe('readCuePoints', () => {
  it('returns empty array when there is no cue chunk', () => {
    const wav = buildWav({ cueSampleOffsets: [], includeCueChunk: false });
    expect(readCuePoints(writeTempWav(wav))).toEqual([]);
  });

  it('ignores reserved empty slots (sample_offset=0)', () => {
    const wav = buildWav({ cueSampleOffsets: [], reservedEmptySlots: 99 });
    expect(readCuePoints(writeTempWav(wav))).toEqual([]);
  });

  it('returns real cue offsets in ascending order, deduped', () => {
    const wav = buildWav({
      cueSampleOffsets: [44100, 88200, 44100, 132300],
      reservedEmptySlots: 95,
    });
    expect(readCuePoints(writeTempWav(wav))).toEqual([44100, 88200, 132300]);
  });

  it('throws when the file is not RIFF/WAVE', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wav-cue-bad-'));
    const path = join(dir, 'bad.wav');
    writeFileSync(path, Buffer.from('not a wav file'));
    expect(() => readCuePoints(path)).toThrow(/not a wav/i);
  });
});
