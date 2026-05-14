import { describe, it, expect } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { model12 } from './model12.js';
import { writeMarker } from './marker.js';

function tempCard(): string {
  return mkdtempSync(join(tmpdir(), 'model12-card-'));
}

function buildWav(opts: {
  cueSampleOffsets: number[];
  reservedEmptySlots?: number;
  durationSec?: number;
}): Buffer {
  const reserved = opts.reservedEmptySlots ?? 0;
  const totalCues = opts.cueSampleOffsets.length + reserved;
  const sampleRate = 44100;
  const samples = Math.floor((opts.durationSec ?? 1.0) * sampleRate);
  const dataBytes = samples * 2;
  const cueBody = Buffer.alloc(4 + totalCues * 24);
  cueBody.writeUInt32LE(totalCues, 0);
  let off = 4;
  for (const sampleOff of opts.cueSampleOffsets) {
    cueBody.writeUInt32LE(sampleOff, off + 20);
    off += 24;
  }
  const cueHdr = Buffer.alloc(8);
  cueHdr.write('cue ', 0, 4, 'ascii');
  cueHdr.writeUInt32LE(cueBody.length, 4);
  const fmt = Buffer.alloc(8 + 16);
  fmt.write('fmt ', 0, 4, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(sampleRate, 12);
  fmt.writeUInt32LE(sampleRate * 2, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const data = Buffer.alloc(8 + dataBytes);
  data.write('data', 0, 4, 'ascii');
  data.writeUInt32LE(dataBytes, 4);
  const payload = Buffer.concat([cueHdr, cueBody, fmt, data]);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 4, 'ascii');
  riff.writeUInt32LE(4 + payload.length, 4);
  riff.write('WAVE', 8, 4, 'ascii');
  return Buffer.concat([riff, payload]);
}

function placeSong(
  card: string,
  songName: string,
  tracks: { tr: number; cues?: number[]; durationSec?: number }[],
  mtime?: Date,
): string {
  const dir = join(card, 'MTR', songName);
  mkdirSync(dir, { recursive: true });
  for (const t of tracks) {
    const fname = `01_${songName}_TR${String(t.tr).padStart(2, '0')}.wav`;
    const path = join(dir, fname);
    writeFileSync(
      path,
      buildWav({
        cueSampleOffsets: t.cues ?? [],
        reservedEmptySlots: Math.max(0, 99 - (t.cues?.length ?? 0)),
        durationSec: t.durationSec ?? 1.0,
      }),
    );
    if (mtime) {
      const ts = mtime.getTime() / 1000;
      utimesSync(path, ts, ts);
    }
  }
  return dir;
}

describe('model12.scan', () => {
  it('returns no tasks for an empty card', async () => {
    const card = tempCard();
    mkdirSync(join(card, 'MTR'), { recursive: true });
    const tasks = await model12.scan(card, {
      stillRecordingThresholdMs: 60000,
    });
    expect(tasks).toEqual([]);
  });

  it('produces one task per folder with no marks', async () => {
    const card = tempCard();
    const mtime = new Date('2026-05-12T20:00:00Z');
    placeSong(card, '260512_0001', [{ tr: 1 }, { tr: 2 }, { tr: 7 }], mtime);
    const tasks = await model12.scan(card, {
      stillRecordingThresholdMs: 60000,
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.segment).toBeNull();
    expect(tasks[0]!.trackPositions).toEqual([1, 2, 7]);
    expect(tasks[0]!.recordedOn).toBe('2026-05-12');
    expect(tasks[0]!.defaultProjectName).toBe('2026-05-12 260512_0001');
    expect(tasks[0]!.status.kind).toBe('new');
  });

  it('splits a folder with N marks into N+1 tasks', async () => {
    const card = tempCard();
    const mtime = new Date('2026-05-12T20:00:00Z');
    placeSong(
      card,
      '260512_0002',
      [
        { tr: 1, cues: [44100, 88200], durationSec: 3.0 },
        { tr: 2, cues: [44100, 88200], durationSec: 3.0 },
      ],
      mtime,
    );
    const tasks = await model12.scan(card, {
      stillRecordingThresholdMs: 60000,
    });
    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.segment?.index)).toEqual([1, 2, 3]);
    expect(tasks[0]!.segment?.startSample).toBe(0);
    expect(tasks[0]!.segment?.endSample).toBe(44100);
    expect(tasks[1]!.segment?.startSample).toBe(44100);
    expect(tasks[1]!.segment?.endSample).toBe(88200);
    expect(tasks[2]!.segment?.startSample).toBe(88200);
    expect(tasks[2]!.segment?.endSample).toBe(132300);
    expect(tasks.map((t) => t.defaultProjectName)).toEqual([
      '2026-05-12 take 1',
      '2026-05-12 take 2',
      '2026-05-12 take 3',
    ]);
  });

  it('uses today when file mtime year < 2020 (clock unset)', async () => {
    const card = tempCard();
    placeSong(
      card,
      '040109_0001',
      [{ tr: 1 }],
      new Date('2004-01-09T20:00:00Z'),
    );
    const tasks = await model12.scan(card, {
      stillRecordingThresholdMs: 60000,
    });
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(tasks[0]!.recordedOn).toBe(today);
  });

  it('marks the task still-recording when mtime is within threshold', async () => {
    const card = tempCard();
    placeSong(card, '260512_0003', [{ tr: 1 }], new Date());
    const tasks = await model12.scan(card, {
      stillRecordingThresholdMs: 60000,
    });
    expect(tasks[0]!.status.kind).toBe('still-recording');
  });

  it('marks the task done when marker says imported', async () => {
    const card = tempCard();
    const mtime = new Date('2026-05-12T20:00:00Z');
    const dir = placeSong(card, '260512_0004', [{ tr: 1 }], mtime);
    writeMarker(dir, {
      song_folder: '260512_0004',
      host: 'h',
      paperstem_url: 'u',
      segments: [
        {
          index: 1,
          of: 1,
          start_sample: 0,
          end_sample: 0,
          name: '2026-05-12 260512_0004',
          project_id: 'pr_xyz',
          uploaded_at: '2026-05-12T20:30:00Z',
        },
      ],
    });
    const tasks = await model12.scan(card, {
      stillRecordingThresholdMs: 60000,
    });
    expect(tasks[0]!.status).toEqual({ kind: 'done', projectId: 'pr_xyz' });
  });

  it('rejects a folder where TR01 and TR02 cue chunks differ', async () => {
    const card = tempCard();
    const mtime = new Date('2026-05-12T20:00:00Z');
    placeSong(
      card,
      '260512_0005',
      [
        { tr: 1, cues: [44100], durationSec: 2.0 },
        { tr: 2, cues: [88200], durationSec: 2.0 },
      ],
      mtime,
    );
    const tasks = await model12.scan(card, {
      stillRecordingThresholdMs: 60000,
    });
    expect(tasks).toHaveLength(0);
  });

  it('ignores non-track files in a song folder', async () => {
    const card = tempCard();
    const dir = placeSong(
      card,
      '260512_0006',
      [{ tr: 1 }],
      new Date('2026-05-12T20:00:00Z'),
    );
    writeFileSync(join(dir, 'song.sys'), Buffer.alloc(2048));
    writeFileSync(join(dir, 'tempTr1_A.bin'), Buffer.alloc(0));
    const tasks = await model12.scan(card, {
      stillRecordingThresholdMs: 60000,
    });
    expect(tasks[0]!.trackFiles).toHaveLength(1);
    expect(tasks[0]!.trackFiles[0]!.endsWith('TR01.wav')).toBe(true);
  });

  it('skips alternate-take files (prefix 02_)', async () => {
    const card = tempCard();
    const dir = placeSong(
      card,
      '260512_0007',
      [{ tr: 1 }],
      new Date('2026-05-12T20:00:00Z'),
    );
    writeFileSync(
      join(dir, '02_260512_0007_TR01.wav'),
      buildWav({ cueSampleOffsets: [], reservedEmptySlots: 99 }),
    );
    const tasks = await model12.scan(card, {
      stillRecordingThresholdMs: 60000,
    });
    expect(tasks[0]!.trackFiles).toHaveLength(1);
    expect(tasks[0]!.trackFiles[0]!.includes('/01_')).toBe(true);
  });
});
