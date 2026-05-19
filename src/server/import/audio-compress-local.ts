import { spawn, spawnSync } from 'node:child_process';

export type CompressOptions = {
  inputPath: string;
  outputPath: string;
  bitrateKbps: number;
  slice?: { startSec: number; durationSec: number };
};

export function ffmpegAvailable(): boolean {
  const res = spawnSync('ffmpeg', ['-version']);
  return res.status === 0;
}

/**
 * Encode any ffmpeg-readable audio to AAC-LC mono in an MP4 container.
 * When `slice` is set, ffmpeg's `-ss`/`-t` is used to extract that range.
 * Resolves on ffmpeg exit code 0; rejects with the captured stderr otherwise.
 */
export function compressToAacMono(opts: CompressOptions): Promise<void> {
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y'];
  if (opts.slice) {
    args.push('-ss', opts.slice.startSec.toFixed(6));
    args.push('-t', opts.slice.durationSec.toFixed(6));
  }
  args.push('-i', opts.inputPath);
  args.push('-vn');
  args.push('-ac', '1');
  args.push('-codec:a', 'aac', '-b:a', `${opts.bitrateKbps}k`);
  args.push('-movflags', '+faststart');
  args.push(opts.outputPath);
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim()}`));
    });
  });
}

/**
 * Probe an audio file's duration with ffprobe. Returns ms (rounded) or null
 * if ffprobe is missing, fails, or produces a non-finite value.
 */
export function probeDurationMs(filePath: string): number | null {
  const res = spawnSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  if (res.status !== 0) return null;
  const seconds = parseFloat(res.stdout.toString().trim());
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds * 1000);
}

/**
 * Probe duration from an in-memory audio buffer by piping to ffprobe.
 * Returns ms (rounded) or null on failure.
 */
export function probeDurationMsFromBuffer(buf: Buffer): Promise<number | null> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      '-i',
      'pipe:0',
    ]);
    let stdout = '';
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const seconds = parseFloat(stdout.trim());
      if (!Number.isFinite(seconds) || seconds <= 0) {
        resolve(null);
        return;
      }
      resolve(Math.round(seconds * 1000));
    });
    proc.stdin.on('error', () => resolve(null));
    proc.stdin.end(buf);
  });
}

/**
 * Streaming-decode `inputArgs` into mono f32 samples at `sampleRate`, bucket
 * into `bins` max-amplitude values, and resolve with the peaks array (or
 * null on failure). Shared between the file and buffer entry points.
 */
function streamPeaks(
  inputArgs: string[],
  stdin: Buffer | null,
  totalSamples: number,
  sampleRate: number,
  bins: number,
): Promise<number[] | null> {
  return new Promise((resolve) => {
    const samplesPerBin = Math.max(1, Math.floor(totalSamples / bins));
    const proc = spawn('ffmpeg', [
      '-v',
      'error',
      ...inputArgs,
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      'f32le',
      '-',
    ]);
    const out = new Array<number>(bins).fill(0);
    let leftover: Buffer = Buffer.alloc(0);
    let sampleIndex = 0;
    let binIndex = 0;
    let currentMax = 0;

    proc.stdout.on('data', (chunk: Buffer) => {
      const data: Buffer =
        leftover.length === 0 ? chunk : Buffer.concat([leftover, chunk]);
      const fullSamples = Math.floor(data.length / 4);
      for (let i = 0; i < fullSamples; i++) {
        const v = Math.abs(data.readFloatLE(i * 4));
        if (v > currentMax) currentMax = v;
        sampleIndex++;
        if (
          binIndex < bins - 1 &&
          sampleIndex >= (binIndex + 1) * samplesPerBin
        ) {
          out[binIndex] = currentMax;
          currentMax = 0;
          binIndex++;
        }
      }
      const usedBytes = fullSamples * 4;
      leftover =
        data.length > usedBytes
          ? Buffer.from(data.subarray(usedBytes))
          : Buffer.alloc(0);
    });

    proc.stderr.on('data', () => {});
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      if (binIndex < bins) out[binIndex] = currentMax;
      resolve(out);
    });

    if (stdin) {
      proc.stdin.on('error', () => resolve(null));
      proc.stdin.end(stdin);
    }
  });
}

/**
 * Compute a max-amplitude envelope (peaks) for an audio file by streaming
 * mono float samples from ffmpeg. Returns `bins` values in 0..1, or null if
 * ffmpeg/ffprobe fails or the file is empty.
 *
 * Matches the client-side `computePeaks` shape: per-bin max(|sample|), not
 * normalized (the v2 wire format the player expects).
 */
export async function computePeaksFromFile(
  filePath: string,
  bins: number,
): Promise<number[] | null> {
  const durationMs = probeDurationMs(filePath);
  if (durationMs === null || durationMs <= 0) return null;
  const sampleRate = 8000;
  const totalSamples = Math.floor((durationMs / 1000) * sampleRate);
  if (totalSamples <= 0) return null;
  return streamPeaks(['-i', filePath], null, totalSamples, sampleRate, bins);
}

/**
 * Same as `computePeaksFromFile` but reads the source audio from an
 * in-memory buffer (piped to ffmpeg via stdin). Convenient for backfill
 * passes that already hold the file bytes.
 */
export async function computePeaksFromBuffer(
  buf: Buffer,
  bins: number,
): Promise<number[] | null> {
  const durationMs = await probeDurationMsFromBuffer(buf);
  if (durationMs === null || durationMs <= 0) return null;
  const sampleRate = 8000;
  const totalSamples = Math.floor((durationMs / 1000) * sampleRate);
  if (totalSamples <= 0) return null;
  return streamPeaks(
    ['-i', 'pipe:0'],
    buf,
    totalSamples,
    sampleRate,
    bins,
  );
}

/**
 * Encode peaks (numbers in 0..1) to the v2 wire format the server's
 * `stems.peaks` column and the player expect.
 */
export function encodePeaksV2(peaks: number[]): string {
  return (
    'v2:' +
    peaks
      .map((p) => Math.round(Math.max(0, Math.min(1, p)) * 255))
      .join(',')
  );
}
