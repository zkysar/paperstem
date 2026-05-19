import { describe, it, expect, beforeAll } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  compressToAacMono,
  computePeaksFromBuffer,
  computePeaksFromFile,
  encodePeaksV2,
  ffmpegAvailable,
  probeDurationMs,
  probeDurationMsFromBuffer,
} from './audio-compress-local.js';

function buildSilentWav(durationSec: number, sampleRate = 44100): Buffer {
  const samples = Math.floor(durationSec * sampleRate);
  const dataBytes = samples * 2;
  const out = Buffer.alloc(44 + dataBytes);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write('WAVE', 8);
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(dataBytes, 40);
  return out;
}

function readMp3Duration(path: string): number {
  const res = spawnSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    path,
  ]);
  return parseFloat(res.stdout.toString().trim());
}

const ffmpegOk = ffmpegAvailable();

describe.skipIf(!ffmpegOk)('compressToAacMono', () => {
  beforeAll(() => {
    if (!ffmpegOk) {
      // eslint-disable-next-line no-console
      console.warn('skipping audio-compress-local tests: ffmpeg not on PATH');
    }
  });

  it('encodes a whole file to MP3 128 kbps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'compress-'));
    const inputPath = join(dir, 'in.wav');
    const outputPath = join(dir, 'out.mp3');
    writeFileSync(inputPath, buildSilentWav(2.0));
    await compressToAacMono({ inputPath, outputPath, bitrateKbps: 128 });
    expect(existsSync(outputPath)).toBe(true);
    expect(statSync(outputPath).size).toBeGreaterThan(0);
    const buf = readFileSync(outputPath);
    // Either an MP3 frame sync (0xFFE/0xFFF) or an ID3v2 tag header ("ID3").
    const isId3 = buf.toString('ascii', 0, 3) === 'ID3';
    const isFrameSync =
      buf[0] === 0xff && ((buf[1] ?? 0) & 0xe0) === 0xe0;
    expect(isId3 || isFrameSync).toBe(true);
    const dur = readMp3Duration(outputPath);
    expect(dur).toBeGreaterThan(1.9);
    expect(dur).toBeLessThan(2.2);
  });

  it('slices a segment when slice is provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'compress-'));
    const inputPath = join(dir, 'in.wav');
    const outputPath = join(dir, 'out.mp3');
    writeFileSync(inputPath, buildSilentWav(5.0));
    await compressToAacMono({
      inputPath,
      outputPath,
      bitrateKbps: 128,
      slice: { startSec: 1.0, durationSec: 2.0 },
    });
    const dur = readMp3Duration(outputPath);
    expect(dur).toBeGreaterThan(1.9);
    expect(dur).toBeLessThan(2.2);
  });

  it('probes duration from a file and a buffer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'compress-'));
    const wavPath = join(dir, 'in.wav');
    writeFileSync(wavPath, buildSilentWav(2.0));
    const ms = probeDurationMs(wavPath);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(1900);
    expect(ms!).toBeLessThan(2100);
    const bufMs = await probeDurationMsFromBuffer(readFileSync(wavPath));
    expect(bufMs).not.toBeNull();
    expect(bufMs!).toBeGreaterThan(1900);
    expect(bufMs!).toBeLessThan(2100);
  });

  it('returns null when probing a non-audio buffer', async () => {
    expect(await probeDurationMsFromBuffer(Buffer.from('garbage'))).toBeNull();
  });

  it('computes peaks from a file and a buffer (silent → zeros)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'compress-'));
    const wavPath = join(dir, 'in.wav');
    writeFileSync(wavPath, buildSilentWav(2.0));
    const filePeaks = await computePeaksFromFile(wavPath, 32);
    expect(filePeaks).not.toBeNull();
    expect(filePeaks!.length).toBe(32);
    // silent file => all zeros (or extremely close)
    expect(filePeaks!.every((v) => v < 0.01)).toBe(true);

    const bufPeaks = await computePeaksFromBuffer(readFileSync(wavPath), 32);
    expect(bufPeaks).not.toBeNull();
    expect(bufPeaks!.length).toBe(32);
  });

  it('encodes peaks to v2 wire format', () => {
    expect(encodePeaksV2([0, 0.5, 1])).toBe('v2:0,128,255');
    expect(encodePeaksV2([-1, 2])).toBe('v2:0,255');
  });

  it('rejects when ffmpeg fails (bogus input)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'compress-'));
    const inputPath = join(dir, 'in.wav');
    const outputPath = join(dir, 'out.mp3');
    writeFileSync(inputPath, Buffer.from('not a wav'));
    await expect(
      compressToAacMono({ inputPath, outputPath, bitrateKbps: 128 }),
    ).rejects.toThrow();
  });
});
