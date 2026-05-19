import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { db } from '../src/server/db.js';
import {
  StorageNotFoundError,
  getFile,
  renameAndRetype,
  updateFile,
} from '../src/server/storage.js';
import type { StemRow } from '../src/server/db.js';

const { values } = parseArgs({
  options: {
    commit: { type: 'boolean', default: false },
    codec: { type: 'string', default: 'mp3' },
    channels: { type: 'string' },
    bitrate: { type: 'string', default: '64' },
    id: { type: 'string' },
    'min-savings-bytes': { type: 'string', default: '524288' },
  },
  strict: true,
});

const COMMIT = values.commit === true;
const CODEC = values.codec === 'aac' ? 'aac' : values.codec === 'mp3' ? 'mp3' : null;
const BITRATE_KBPS = Number(values.bitrate);
const MIN_SAVINGS = Number(values['min-savings-bytes']);
const ONLY_ID = values.id?.trim();
const CHANNELS = values.channels !== undefined
  ? Number(values.channels)
  : CODEC === 'aac'
    ? 1
    : 2;

if (CODEC === null) {
  console.error(`invalid --codec=${values.codec} (expected 'aac' or 'mp3')`);
  process.exit(1);
}
if (!Number.isFinite(BITRATE_KBPS) || BITRATE_KBPS < 32 || BITRATE_KBPS > 320) {
  console.error(`invalid --bitrate=${values.bitrate} (expected 32..320)`);
  process.exit(1);
}
if (!Number.isFinite(MIN_SAVINGS) || MIN_SAVINGS < 0) {
  console.error(`invalid --min-savings-bytes=${values['min-savings-bytes']}`);
  process.exit(1);
}
if (!Number.isFinite(CHANNELS) || (CHANNELS !== 1 && CHANNELS !== 2)) {
  console.error(`invalid --channels=${values.channels} (expected 1 or 2)`);
  process.exit(1);
}

const TARGET_EXT = CODEC === 'aac' ? '.m4a' : '.mp3';
const TARGET_MIME = CODEC === 'aac' ? 'audio/mp4' : 'audio/mpeg';

const header = COMMIT ? 'COMMIT' : 'DRY-RUN';
console.log(
  `backprocess-stems [${header}] codec=${CODEC} channels=${CHANNELS} @ ${BITRATE_KBPS}kbps`,
);
console.log(
  `min savings to keep: ${(MIN_SAVINGS / 1024 / 1024).toFixed(2)} MB`,
);

type StemWithPath = StemRow & { band_id: string; band_name: string; project_name: string };

const allStems = ONLY_ID
  ? (db
      .prepare(
        `SELECT s.*, p.band_id, b.name AS band_name, p.name AS project_name
           FROM stems s
           JOIN projects p ON p.id = s.project_id
           JOIN bands b ON b.id = p.band_id
          WHERE s.id = ?
            AND s.deleted_at IS NULL
            AND p.deleted_at IS NULL`,
      )
      .all(ONLY_ID) as StemWithPath[])
  : (db
      .prepare(
        `SELECT s.*, p.band_id, b.name AS band_name, p.name AS project_name
           FROM stems s
           JOIN projects p ON p.id = s.project_id
           JOIN bands b ON b.id = p.band_id
          WHERE s.deleted_at IS NULL
            AND p.deleted_at IS NULL
          ORDER BY b.name, p.recorded_on, p.created_at, s.position`,
      )
      .all() as StemWithPath[]);

function storageFilename(fileId: string): string {
  const rel = Buffer.from(fileId, 'base64url').toString('utf8');
  const slash = rel.lastIndexOf('/');
  return slash === -1 ? rel : rel.slice(slash + 1);
}

function currentExt(fileId: string): string {
  const name = storageFilename(fileId);
  const i = name.lastIndexOf('.');
  return i === -1 || i === 0 ? '' : name.slice(i).toLowerCase();
}

const candidates = allStems.filter(
  (s) => !(currentExt(s.file_id) === TARGET_EXT && s.duration_ms != null),
);
const alreadyDone = allStems.length - candidates.length;

const upfrontBytes = candidates.reduce((n, s) => n + (s.size_bytes ?? 0), 0);
console.log(
  `stems considered: ${allStems.length}  candidates: ${candidates.length}  already in target format: ${alreadyDone}`,
);
console.log(`candidate total size: ${(upfrontBytes / 1024 / 1024).toFixed(2)} MB`);
if (candidates.length === 0) process.exit(0);

const updateSize = db.prepare<[number, number | null, string]>(
  'UPDATE stems SET size_bytes = ?, duration_ms = COALESCE(?, duration_ms) WHERE id = ?',
);
const updateFileIdAndMeta = db.prepare<[string, number, number | null, string]>(
  'UPDATE stems SET file_id = ?, size_bytes = ?, duration_ms = COALESCE(?, duration_ms) WHERE id = ?',
);

function withTargetExt(name: string): string {
  const i = name.lastIndexOf('.');
  const base = i === -1 || i === 0 ? name : name.slice(0, i);
  return `${base}${TARGET_EXT}`;
}

type Stats = {
  processed: number;
  skippedSmaller: number;
  skippedTrivial: number;
  failed: number;
  bytesBefore: number;
  bytesAfter: number;
};

const stats: Stats = {
  processed: 0,
  skippedSmaller: 0,
  skippedTrivial: 0,
  failed: 0,
  bytesBefore: 0,
  bytesAfter: 0,
};

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function transcodeToFile(input: Buffer, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const codecArgs =
      CODEC === 'aac'
        ? ['-c:a', 'aac', '-b:a', `${BITRATE_KBPS}k`, '-movflags', '+faststart', '-f', 'mp4']
        : ['-c:a', 'libmp3lame', '-b:a', `${BITRATE_KBPS}k`, '-f', 'mp3'];
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      'pipe:0',
      '-vn',
      '-ac',
      String(CHANNELS),
      ...codecArgs,
      outPath,
    ];
    const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    const err: Buffer[] = [];
    ff.stderr.on('data', (c: Buffer) => err.push(c));
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `ffmpeg exited ${code}: ${Buffer.concat(err).toString().trim()}`,
          ),
        );
    });
    ff.stdin.on('error', reject);
    ff.stdin.end(input);
  });
}

function ffprobeDurationSeconds(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path,
    ];
    const proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.stderr.on('data', (c: Buffer) => err.push(c));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited ${code}: ${Buffer.concat(err).toString().trim()}`));
        return;
      }
      const text = Buffer.concat(out).toString().trim();
      const n = Number(text);
      if (!Number.isFinite(n) || n <= 0) {
        reject(new Error(`ffprobe produced unparseable duration: ${JSON.stringify(text)}`));
        return;
      }
      resolve(n);
    });
  });
}

function fmt(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

let index = 0;
for (const stem of candidates) {
  index++;
  const label = `[${index}/${candidates.length}] ${stem.band_name} / ${stem.project_name} / ${stem.name}`;
  let scratch: string | null = null;
  try {
    const { body } = await getFile(stem.file_id);
    const original = await streamToBuffer(body);
    const before = original.length;
    stats.bytesBefore += before;

    scratch = await mkdtemp(join(tmpdir(), 'paperstem-backprocess-'));
    const outPath = join(scratch, `out${TARGET_EXT}`);
    await transcodeToFile(original, outPath);
    const encoded = await readFile(outPath);
    const after = encoded.length;
    const savings = before - after;

    if (savings <= 0) {
      stats.skippedSmaller++;
      stats.bytesAfter += before;
      console.log(`${label}  ${fmt(before)} → ${fmt(after)}  skip (no savings)`);
      continue;
    }
    if (savings < MIN_SAVINGS) {
      stats.skippedTrivial++;
      stats.bytesAfter += before;
      console.log(
        `${label}  ${fmt(before)} → ${fmt(after)}  skip (savings < threshold)`,
      );
      continue;
    }

    const durationSec = await ffprobeDurationSeconds(outPath);
    const durationMs = Math.round(durationSec * 1000);
    const newDurationForUpdate = stem.duration_ms == null ? durationMs : null;

    const currentName = storageFilename(stem.file_id) || stem.name;
    const newName = withTargetExt(currentName);
    const needsRename = currentName !== newName;

    if (COMMIT) {
      // Order matters: rename the storage entry first so the new bytes land
      // at the new path (and matching MIME). If updateFile() ran first and
      // the process crashed before the rename, the row would still resolve
      // to e.g. `*.mp3` while the bytes on disk were already MP4 — the
      // serve path would hand the browser AAC under `audio/mpeg`, a silent
      // playback failure. With rename-first, a mid-step crash leaves the
      // DB pointing at a path that no longer exists, which the audio
      // handler already detects and surfaces as `drive_missing` (HTTP 410).
      let activeFileId = stem.file_id;
      if (needsRename) {
        const renamed = await renameAndRetype(stem.file_id, newName, TARGET_MIME);
        activeFileId = renamed.id;
      }
      const res = await updateFile(activeFileId, TARGET_MIME, encoded);
      if (needsRename) {
        updateFileIdAndMeta.run(activeFileId, res.size, newDurationForUpdate, stem.id);
      } else {
        updateSize.run(res.size, newDurationForUpdate, stem.id);
      }
    }
    stats.processed++;
    stats.bytesAfter += after;
    const durNote = newDurationForUpdate != null ? `  duration_ms=${durationMs}` : '';
    console.log(
      `${label}  ${fmt(before)} → ${fmt(after)}  -${fmt(savings)}${durNote}` +
        (COMMIT ? '  written' : '  (dry-run)'),
    );
  } catch (e) {
    stats.failed++;
    const msg =
      e instanceof StorageNotFoundError
        ? `storage file not found: ${stem.file_id}`
        : e instanceof Error
          ? e.message
          : String(e);
    console.warn(`${label}  FAILED: ${msg}`);
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

const totalSavings = stats.bytesBefore - stats.bytesAfter;
console.log('');
console.log('--- summary ---');
console.log(`mode:            ${COMMIT ? 'COMMIT (writes performed)' : 'DRY-RUN (no writes)'}`);
console.log(`codec:           ${CODEC} (${TARGET_MIME})  channels: ${CHANNELS}  bitrate: ${BITRATE_KBPS}k`);
console.log(`considered:      ${allStems.length}`);
console.log(`already done:    ${alreadyDone}`);
console.log(`candidates:      ${candidates.length}`);
console.log(`would replace:   ${stats.processed}`);
console.log(`skipped (same):  ${stats.skippedSmaller}`);
console.log(`skipped (tiny):  ${stats.skippedTrivial}`);
console.log(`failed:          ${stats.failed}`);
console.log(`bytes before:    ${fmt(stats.bytesBefore)}`);
console.log(`bytes after:     ${fmt(stats.bytesAfter)}`);
console.log(`savings:         ${fmt(totalSavings)}`);

if (stats.failed > 0) process.exit(2);
