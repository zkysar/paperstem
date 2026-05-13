import { closeSync, openSync, readSync, statSync } from 'node:fs';

/**
 * Parse the RIFF `cue ` chunk from a WAV file at `path` and return the
 * sample offsets in ascending order. Reserved empty slots (sample_offset=0)
 * are dropped — the Model 12 pre-allocates 99 of these. Duplicates are
 * dropped. If the file has no `cue ` chunk, returns [].
 */
export function readCuePoints(path: string): number[] {
  const fd = openSync(path, 'r');
  try {
    const fileSize = statSync(path).size;
    const header = Buffer.alloc(12);
    readSync(fd, header, 0, 12, 0);
    if (
      header.toString('ascii', 0, 4) !== 'RIFF' ||
      header.toString('ascii', 8, 12) !== 'WAVE'
    ) {
      throw new Error(`not a WAV/RIFF file: ${path}`);
    }
    let pos = 12;
    while (pos + 8 <= fileSize) {
      const ch = Buffer.alloc(8);
      readSync(fd, ch, 0, 8, pos);
      const chunkId = ch.toString('ascii', 0, 4);
      const chunkSize = ch.readUInt32LE(4);
      if (chunkId === 'cue ') {
        const body = Buffer.alloc(chunkSize);
        readSync(fd, body, 0, chunkSize, pos + 8);
        const count = body.readUInt32LE(0);
        const offsets: number[] = [];
        for (let i = 0; i < count; i++) {
          const base = 4 + i * 24;
          if (base + 24 > body.length) break;
          const sampleOffset = body.readUInt32LE(base + 20);
          if (sampleOffset > 0) offsets.push(sampleOffset);
        }
        return Array.from(new Set(offsets)).sort((a, b) => a - b);
      }
      pos += 8 + chunkSize + (chunkSize & 1);
    }
    return [];
  } finally {
    closeSync(fd);
  }
}
