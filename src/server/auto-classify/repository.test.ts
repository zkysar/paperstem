import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  insertFingerprint,
  listFingerprintsForBand,
  listFingerprintsForSong,
  insertClassificationRun,
  updateClassificationRunStatus,
} from './repository.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function seedDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(join(__dirname, '../schema.sql'), 'utf-8'));
  db.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1','a@b',0)").run();
  db.prepare(
    "INSERT INTO bands (id, name, folder_id, owner_user_id, created_at) VALUES ('b1','Band','f1','u1',0)",
  ).run();
  db.prepare(
    "INSERT INTO songs (id, band_id, name, name_norm, created_at, created_by) VALUES ('s1','b1','Wagon Wheel','wagon wheel',0,'u1')",
  ).run();
  db.prepare(
    "INSERT INTO songs (id, band_id, name, name_norm, created_at, created_by) VALUES ('s2','b1','Heart Sounds','heart sounds',0,'u1')",
  ).run();
  db.prepare(
    "INSERT INTO projects (id, band_id, name, folder_id, created_at, created_by, updated_at) VALUES ('p1','b1','Practice','f2',0,'u1',0)",
  ).run();
  db.prepare(
    "INSERT INTO sections (id, project_id, start_ms, song_id, source, created_at, created_by, updated_at) VALUES ('sec1','p1',0,'s1','manual',0,'u1',0)",
  ).run();
  db.prepare(
    "INSERT INTO sections (id, project_id, start_ms, song_id, source, created_at, created_by, updated_at) VALUES ('sec2','p1',5000,'s2','manual',0,'u1',0)",
  ).run();
  return db;
}

describe('repository', () => {
  it('inserts and lists fingerprints for a band', () => {
    const db = seedDb();
    const blob = Buffer.from([1, 2, 3, 4]);
    insertFingerprint(db, {
      id: 'fp1',
      band_id: 'b1',
      song_id: 's1',
      section_id: 'sec1',
      fingerprint_blob: blob,
      fingerprint_version: 1,
      duration_ms: 5000,
      created_at: 0,
    });
    const rows = listFingerprintsForBand(db, 'b1');
    expect(rows).toHaveLength(1);
    expect(rows[0].song_id).toBe('s1');
    expect(rows[0].fingerprint_blob).toEqual(blob);
  });

  it('filters fingerprints by song_id when listing for a specific song', () => {
    const db = seedDb();
    insertFingerprint(db, {
      id: 'fp1', band_id: 'b1', song_id: 's1', section_id: 'sec1',
      fingerprint_blob: Buffer.from([1]), fingerprint_version: 1, duration_ms: 5000, created_at: 0,
    });
    insertFingerprint(db, {
      id: 'fp2', band_id: 'b1', song_id: 's2', section_id: 'sec2',
      fingerprint_blob: Buffer.from([2]), fingerprint_version: 1, duration_ms: 6000, created_at: 1,
    });
    const s1 = listFingerprintsForSong(db, 'b1', 's1');
    expect(s1).toHaveLength(1);
    expect(s1[0].id).toBe('fp1');
    const s2 = listFingerprintsForSong(db, 'b1', 's2');
    expect(s2).toHaveLength(1);
    expect(s2[0].id).toBe('fp2');
  });

  it('records classification run status transitions', () => {
    const db = seedDb();
    insertClassificationRun(db, {
      id: 'run1',
      project_id: 'p1',
      status: 'pending',
      source_surface: 'web',
      audio_hash: 'h',
      classifier_version: 'yamnet-v1',
      fingerprint_version: 1,
      error: null,
      created_at: 0,
      completed_at: null,
    });
    updateClassificationRunStatus(db, 'run1', 'done', { completed_at: 100, error: null });
    const row = db
      .prepare('SELECT status, completed_at FROM classification_runs WHERE id=?')
      .get('run1') as { status: string; completed_at: number };
    expect(row.status).toBe('done');
    expect(row.completed_at).toBe(100);
  });

  it('records a failed run with the error message preserved', () => {
    const db = seedDb();
    insertClassificationRun(db, {
      id: 'run2', project_id: 'p1', status: 'running', source_surface: 'cli',
      audio_hash: 'h2', classifier_version: 'yamnet-v1', fingerprint_version: 1,
      error: null, created_at: 0, completed_at: null,
    });
    updateClassificationRunStatus(db, 'run2', 'failed', {
      completed_at: 200,
      error: 'boom',
    });
    const row = db
      .prepare('SELECT status, error FROM classification_runs WHERE id=?')
      .get('run2') as { status: string; error: string };
    expect(row.status).toBe('failed');
    expect(row.error).toBe('boom');
  });
});
