import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { db, stmts, type BandRow } from '../db.js';
import {
  createFolder,
  deleteFile,
  findFolderByName,
  listFolder,
  uploadFile,
} from '../drive.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', 'schema.sql');
const BACKUP_FOLDER_NAME = '_backup';
const BACKUP_MIME = 'application/x-sqlite3';
const BACKUP_RETENTION = 8;
const BACKUP_FILENAME_RE = /^d1-\d{4}-\d{2}-\d{2}\.sqlite$/;

function loadSchema(): string {
  return readFileSync(SCHEMA_PATH, 'utf8');
}

function utcDateString(nowMs: number): string {
  const d = new Date(nowMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function buildBandDump(bandId: string): Buffer {
  const band = stmts.findBandById.get(bandId);
  if (!band) throw new Error(`buildBandDump: band ${bandId} not found`);

  const dump = new Database(':memory:');
  try {
    dump.pragma('foreign_keys = OFF');
    dump.exec(loadSchema());

    dump
      .prepare(
        `INSERT INTO bands (id, name, drive_folder_id, owner_user_id, created_at, last_snapshot_at, last_backup_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        band.id,
        band.name,
        band.drive_folder_id,
        band.owner_user_id,
        band.created_at,
        band.last_snapshot_at,
        band.last_backup_at,
      );

    const users = db
      .prepare<
        [string],
        { id: string; email: string; display_name: string | null; created_at: number }
      >(
        `SELECT u.id, u.email, u.display_name, u.created_at
           FROM users u
           JOIN memberships m ON m.user_id = u.id
          WHERE m.band_id = ?`,
      )
      .all(bandId);
    const insertUser = dump.prepare(
      `INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)`,
    );
    for (const u of users) {
      insertUser.run(u.id, u.email, u.display_name, u.created_at);
    }

    const memberships = db
      .prepare<
        [string],
        {
          band_id: string;
          user_id: string;
          role: 'owner' | 'member';
          created_at: number;
        }
      >(
        `SELECT band_id, user_id, role, created_at
           FROM memberships
          WHERE band_id = ?`,
      )
      .all(bandId);
    const insertMembership = dump.prepare(
      `INSERT INTO memberships (band_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
    );
    for (const m of memberships) {
      insertMembership.run(m.band_id, m.user_id, m.role, m.created_at);
    }

    const projects = stmts.findProjectsForBand.all(bandId);
    const insertProject = dump.prepare(
      `INSERT INTO projects
         (id, band_id, name, recorded_on, drive_folder_id, bpm, reference_stem, notes, created_at, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of projects) {
      insertProject.run(
        p.id,
        p.band_id,
        p.name,
        p.recorded_on,
        p.drive_folder_id,
        p.bpm,
        p.reference_stem,
        p.notes,
        p.created_at,
        p.created_by,
        p.updated_at,
      );
    }

    const insertStem = dump.prepare(
      `INSERT INTO stems (id, project_id, name, position, drive_file_id, duration_ms, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of projects) {
      const stems = stmts.findStemsForProject.all(p.id);
      for (const s of stems) {
        insertStem.run(
          s.id,
          s.project_id,
          s.name,
          s.position,
          s.drive_file_id,
          s.duration_ms,
          s.size_bytes,
        );
      }
    }

    const insertAnnotation = dump.prepare(
      `INSERT INTO annotations
         (id, project_id, user_id, start_ms, end_ms, body, starred, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of projects) {
      const annotations = stmts.findAnnotationsForProject.all(p.id);
      for (const a of annotations) {
        insertAnnotation.run(
          a.id,
          a.project_id,
          a.user_id,
          a.start_ms,
          a.end_ms,
          a.body,
          a.starred,
          a.created_at,
          a.updated_at,
        );
      }
    }

    return dump.serialize();
  } finally {
    dump.close();
  }
}

export function selectFilesToDelete(
  files: { id: string; name: string }[],
  retain: number,
): { id: string; name: string }[] {
  const dumps = files.filter((f) => BACKUP_FILENAME_RE.test(f.name));
  const sorted = [...dumps].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return sorted.slice(retain);
}

async function ensureBackupFolder(band: BandRow): Promise<string> {
  const existing = await findFolderByName(BACKUP_FOLDER_NAME, band.drive_folder_id);
  if (existing) return existing.id;
  const created = await createFolder(BACKUP_FOLDER_NAME, band.drive_folder_id);
  return created.id;
}

let runInFlight: Promise<void> | null = null;

export async function runBackupsNow(): Promise<void> {
  if (runInFlight) return runInFlight;
  runInFlight = (async () => {
    const bands = stmts.findAllBands.all();
    for (const band of bands) {
      try {
        const dump = buildBandDump(band.id);
        const date = utcDateString(Date.now());
        const filename = `d1-${date}.sqlite`;
        const backupFolderId = await ensureBackupFolder(band);
        await uploadFile(backupFolderId, filename, BACKUP_MIME, dump);

        const files = await listFolder(backupFolderId);
        const toDelete = selectFilesToDelete(files, BACKUP_RETENTION);
        for (const f of toDelete) {
          try {
            await deleteFile(f.id);
          } catch (err) {
            console.error(
              `[backups] band=${band.id} delete ${f.name} failed:`,
              err,
            );
          }
        }

        stmts.setBandLastBackupAt.run(
          Math.floor(Date.now() / 1000),
          band.id,
        );
        console.log(
          `[backups] band=${band.id} uploaded=${filename} pruned=${toDelete.length}`,
        );
      } catch (err) {
        console.error(`[backups] band=${band.id} failed:`, err);
      }
    }
  })().finally(() => {
    runInFlight = null;
  });
  return runInFlight;
}
