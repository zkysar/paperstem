import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { db } from '../src/server/db.js';
import {
  DriveNotFoundError,
  getDriveFile,
  renameAndRetype,
  updateFile,
} from '../src/server/drive.js';
import type { StemRow } from '../src/server/db.js';

const { values } = parseArgs({
  options: {
    commit: { type: 'boolean', default: false },
    bitrate: { type: 'string', default: '128' },
    id: { type: 'string' },
    'min-savings-bytes': { type: 'string', default: '524288' },
  },
  strict: true,
});

const COMMIT = values.commit === true;
const BITRATE_KBPS = Number(values.bitrate);
const MIN_SAVINGS = Number(values['min-savings-bytes']);
const ONLY_ID = values.id?.trim();

if (!Number.isFinite(BITRATE_KBPS) || BITRATE_KBPS < 32 || BITRATE_KBPS > 320) {
  console.error(`invalid --bitrate=${values.bitrate} (expected 32..320)`);
  process.exit(1);
}
if (!Number.isFinite(MIN_SAVINGS) || MIN_SAVINGS < 0) {
  console.error(`invalid --min-savings-bytes=${values['min-savings-bytes']}`);
  process.exit(1);
}

const header = COMMIT ? 'COMMIT' : 'DRY-RUN';
console.log(`backprocess-stems [${header}] @ ${BITRATE_KBPS}kbps`);
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

console.log(`stems to consider: ${allStems.length}`);
if (allStems.length === 0) process.exit(0);

const updateSize = db.prepare<[number, string]>(
  'UPDATE stems SET size_bytes = ? WHERE id = ?',
);
const updateDriveId = db.prepare<[string, number, string]>(
  'UPDATE stems SET file_id = ?, size_bytes = ? WHERE id = ?',
);

function withMp3Ext(name: string): string {
  const i = name.lastIndexOf('.');
  const base = i === -1 || i === 0 ? name : name.slice(0, i);
  return `${base}.mp3`;
}

function driveFilename(driveFileId: string): string {
  if (driveFileId.startsWith('local:')) {
    const rel = Buffer.from(driveFileId.slice('local:'.length), 'base64url').toString('utf8');
    const slash = rel.lastIndexOf('/');
    return slash === -1 ? rel : rel.slice(slash + 1);
  }
  return '';
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

function transcode(input: Buffer, kbps: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-vn',
      '-c:a',
      'libmp3lame',
      '-b:a',
      `${kbps}k`,
      '-f',
      'mp3',
      'pipe:1',
    ];
    const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    ff.stdout.on('data', (c: Buffer) => out.push(c));
    ff.stderr.on('data', (c: Buffer) => err.push(c));
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
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

function fmt(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

let index = 0;
for (const stem of allStems) {
  index++;
  const label = `[${index}/${allStems.length}] ${stem.band_name} / ${stem.project_name} / ${stem.name}`;
  try {
    const { body } = await getDriveFile(stem.file_id);
    const original = await streamToBuffer(body);
    const before = original.length;
    stats.bytesBefore += before;

    const encoded = await transcode(original, BITRATE_KBPS);
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

    const currentName = driveFilename(stem.file_id) || stem.name;
    const newName = withMp3Ext(currentName);
    const needsRename = currentName !== newName;

    if (COMMIT) {
      const res = await updateFile(stem.file_id, 'audio/mpeg', encoded);
      if (needsRename) {
        const renamed = await renameAndRetype(stem.file_id, newName, 'audio/mpeg');
        updateDriveId.run(renamed.id, res.size, stem.id);
      } else {
        updateSize.run(res.size, stem.id);
      }
    }
    stats.processed++;
    stats.bytesAfter += after;
    console.log(
      `${label}  ${fmt(before)} → ${fmt(after)}  -${fmt(savings)}` +
        (COMMIT ? '  written' : '  (dry-run)'),
    );
  } catch (e) {
    stats.failed++;
    const msg =
      e instanceof DriveNotFoundError
        ? `drive file not found: ${stem.file_id}`
        : e instanceof Error
          ? e.message
          : String(e);
    console.warn(`${label}  FAILED: ${msg}`);
  }
}

const totalSavings = stats.bytesBefore - stats.bytesAfter;
console.log('');
console.log('--- summary ---');
console.log(`mode:            ${COMMIT ? 'COMMIT (writes performed)' : 'DRY-RUN (no writes)'}`);
console.log(`considered:      ${allStems.length}`);
console.log(`would replace:   ${stats.processed}`);
console.log(`skipped (same):  ${stats.skippedSmaller}`);
console.log(`skipped (tiny):  ${stats.skippedTrivial}`);
console.log(`failed:          ${stats.failed}`);
console.log(`bytes before:    ${fmt(stats.bytesBefore)}`);
console.log(`bytes after:     ${fmt(stats.bytesAfter)}`);
console.log(`savings:         ${fmt(totalSavings)}`);

if (stats.failed > 0) process.exit(2);
