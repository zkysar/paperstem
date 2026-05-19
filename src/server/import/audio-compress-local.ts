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
