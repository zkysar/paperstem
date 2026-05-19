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
import { compressToAacMono, ffmpegAvailable } from './audio-compress-local.js';

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

function readAudioDuration(path: string): number {
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

function readChannelCount(path: string): number {
  const res = spawnSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=channels',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    path,
  ]);
  return parseInt(res.stdout.toString().trim(), 10);
}

function readCodec(path: string): string {
  const res = spawnSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    path,
  ]);
  return res.stdout.toString().trim();
}

const ffmpegOk = ffmpegAvailable();

describe.skipIf(!ffmpegOk)('compressToAacMono', () => {
  beforeAll(() => {
    if (!ffmpegOk) {
      // eslint-disable-next-line no-console
      console.warn('skipping audio-compress-local tests: ffmpeg not on PATH');
    }
  });

  it('encodes a whole file to AAC mono in an MP4 container', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'compress-'));
    const inputPath = join(dir, 'in.wav');
    const outputPath = join(dir, 'out.m4a');
    writeFileSync(inputPath, buildSilentWav(2.0));
    await compressToAacMono({ inputPath, outputPath, bitrateKbps: 64 });
    expect(existsSync(outputPath)).toBe(true);
    expect(statSync(outputPath).size).toBeGreaterThan(0);
    const buf = readFileSync(outputPath);
    // MP4 container — bytes 4..8 should be "ftyp".
    expect(buf.toString('ascii', 4, 8)).toBe('ftyp');
    const dur = readAudioDuration(outputPath);
    expect(dur).toBeGreaterThan(1.9);
    expect(dur).toBeLessThan(2.2);
    expect(readChannelCount(outputPath)).toBe(1);
    expect(readCodec(outputPath)).toBe('aac');
  });

  it('downmixes stereo input to mono', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'compress-'));
    const inputPath = join(dir, 'in.wav');
    const outputPath = join(dir, 'out.m4a');
    // Build a 2-channel WAV header so ffmpeg sees stereo input.
    const sampleRate = 44100;
    const samples = Math.floor(2.0 * sampleRate);
    const dataBytes = samples * 2 * 2;
    const out = Buffer.alloc(44 + dataBytes);
    out.write('RIFF', 0);
    out.writeUInt32LE(36 + dataBytes, 4);
    out.write('WAVE', 8);
    out.write('fmt ', 12);
    out.writeUInt32LE(16, 16);
    out.writeUInt16LE(1, 20);
    out.writeUInt16LE(2, 22);
    out.writeUInt32LE(sampleRate, 24);
    out.writeUInt32LE(sampleRate * 4, 28);
    out.writeUInt16LE(4, 32);
    out.writeUInt16LE(16, 34);
    out.write('data', 36);
    out.writeUInt32LE(dataBytes, 40);
    writeFileSync(inputPath, out);
    await compressToAacMono({ inputPath, outputPath, bitrateKbps: 64 });
    expect(readChannelCount(outputPath)).toBe(1);
  });

  it('slices a segment when slice is provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'compress-'));
    const inputPath = join(dir, 'in.wav');
    const outputPath = join(dir, 'out.m4a');
    writeFileSync(inputPath, buildSilentWav(5.0));
    await compressToAacMono({
      inputPath,
      outputPath,
      bitrateKbps: 64,
      slice: { startSec: 1.0, durationSec: 2.0 },
    });
    const dur = readAudioDuration(outputPath);
    expect(dur).toBeGreaterThan(1.9);
    expect(dur).toBeLessThan(2.2);
  });

  it('rejects when ffmpeg fails (bogus input)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'compress-'));
    const inputPath = join(dir, 'in.wav');
    const outputPath = join(dir, 'out.m4a');
    writeFileSync(inputPath, Buffer.from('not a wav'));
    await expect(
      compressToAacMono({ inputPath, outputPath, bitrateKbps: 64 }),
    ).rejects.toThrow();
  });
});
