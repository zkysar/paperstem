import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { db } from '../src/server/db.js';
import { StorageNotFoundError, getFile } from '../src/server/storage.js';
import type { StemRow } from '../src/server/db.js';

const { values } = parseArgs({
  options: {
    commit: { type: 'boolean', default: false },
    id: { type: 'string' },
  },
  strict: true,
});

const COMMIT = values.commit === true;
const ONLY_ID = values.id?.trim();

const header = COMMIT ? 'COMMIT' : 'DRY-RUN';
console.log(`backfill-stem-durations [${header}]`);

type StemWithCtx = StemRow & { band_name: string; project_name: string };

const baseQuery = `
  SELECT s.*, b.name AS band_name, p.name AS project_name
    FROM stems s
    JOIN projects p ON p.id = s.project_id
    JOIN bands b ON b.id = p.band_id
   WHERE s.duration_ms IS NULL
     AND s.deleted_at IS NULL
     AND p.deleted_at IS NULL
`;

const rows = ONLY_ID
  ? (db
      .prepare(`${baseQuery} AND s.id = ?`)
      .all(ONLY_ID) as StemWithCtx[])
  : (db
      .prepare(`${baseQuery} ORDER BY b.name, p.recorded_on, p.created_at, s.position`)
      .all() as StemWithCtx[]);

console.log(`stems with NULL duration_ms: ${rows.length}`);
if (rows.length === 0) process.exit(0);

const updateDuration = db.prepare<[number, string]>(
  'UPDATE stems SET duration_ms = ? WHERE id = ?',
);

async function downloadToFile(stream: ReadableStream<Uint8Array>, path: string): Promise<void> {
  await pipeline(
    Readable.fromWeb(stream as import('node:stream/web').ReadableStream<Uint8Array>),
    createWriteStream(path),
  );
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

const stats = { updated: 0, failed: 0 };

let index = 0;
for (const stem of rows) {
  index++;
  const label = `[${index}/${rows.length}] ${stem.band_name} / ${stem.project_name} / ${stem.name}`;
  let scratch: string | null = null;
  try {
    scratch = await mkdtemp(join(tmpdir(), 'paperstem-backfill-'));
    const path = join(scratch, 'audio.bin');
    const { body } = await getFile(stem.file_id);
    await downloadToFile(body, path);
    const seconds = await ffprobeDurationSeconds(path);
    const ms = Math.round(seconds * 1000);
    if (COMMIT) updateDuration.run(ms, stem.id);
    stats.updated++;
    console.log(`${label}  ${(seconds).toFixed(2)}s → duration_ms=${ms}${COMMIT ? '' : ' (dry-run)'}`);
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

console.log('');
console.log('--- summary ---');
console.log(`mode:    ${COMMIT ? 'COMMIT (writes performed)' : 'DRY-RUN (no writes)'}`);
console.log(`updated: ${stats.updated}`);
console.log(`failed:  ${stats.failed}`);

if (stats.failed > 0) process.exit(2);
