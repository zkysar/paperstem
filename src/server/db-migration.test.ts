import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-migration-test-'));

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

type DbModule = typeof import('./db.js');
let dbMod: DbModule;

beforeAll(async () => {
  process.env.DATABASE_PATH = join(tmpDir, 'unused.sqlite');
  process.env.GMAIL_USER = 'test@example.com';
  process.env.GMAIL_APP_PASSWORD = 'test-pass';
  dbMod = await import('./db.js');
});

function makeLegacyDb(path: string): Database.Database {
  const d = new Database(path);
  d.pragma('foreign_keys = ON');
  d.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, display_name TEXT, created_at INTEGER);
    CREATE TABLE bands (id TEXT PRIMARY KEY, name TEXT, drive_folder_id TEXT, owner_user_id TEXT, created_at INTEGER, last_snapshot_at INTEGER, last_backup_at INTEGER);
    CREATE TABLE practices (
      id TEXT PRIMARY KEY,
      band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      recorded_on TEXT,
      drive_folder_id TEXT NOT NULL,
      bpm INTEGER,
      reference_stem TEXT,
      notes TEXT,
      created_at INTEGER NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_practices_band_recorded ON practices(band_id, recorded_on DESC);
    CREATE TABLE stems (
      id TEXT PRIMARY KEY,
      practice_id TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      drive_file_id TEXT NOT NULL,
      duration_ms INTEGER,
      size_bytes INTEGER
    );
    CREATE INDEX idx_stems_practice ON stems(practice_id, position);
    CREATE TABLE annotations (
      id TEXT PRIMARY KEY,
      practice_id TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER,
      body TEXT NOT NULL,
      starred INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_annotations_practice_user ON annotations(practice_id, user_id);
    CREATE INDEX idx_annotations_practice_start ON annotations(practice_id, start_ms);

    INSERT INTO users (id, email, display_name, created_at) VALUES ('u1', 'a@b.c', null, 1);
    INSERT INTO bands (id, name, drive_folder_id, owner_user_id, created_at, last_snapshot_at, last_backup_at)
      VALUES ('b1', 'Band', 'fld', 'u1', 1, null, null);
    INSERT INTO practices (id, band_id, name, recorded_on, drive_folder_id, bpm, reference_stem, notes, created_at, created_by, updated_at)
      VALUES ('p1', 'b1', 'Old practice', null, 'pfld', null, null, null, 1, 'u1', 1);
    INSERT INTO stems (id, practice_id, name, position, drive_file_id, duration_ms, size_bytes)
      VALUES ('s1', 'p1', 'bass', 0, 'd1', null, null);
    INSERT INTO annotations (id, practice_id, user_id, start_ms, end_ms, body, starred, created_at, updated_at)
      VALUES ('a1', 'p1', 'u1', 0, null, 'note', 0, 1, 1);
  `);
  return d;
}

describe('migrateLegacyPracticesTable', () => {
  it('renames practices -> projects, practice_id -> project_id, drops old indexes, preserves rows and FKs', () => {
    const path = join(tmpDir, 'legacy.sqlite');
    const d = makeLegacyDb(path);

    dbMod.migrateLegacyPracticesTable(d);

    const tables = d
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain('projects');
    expect(tables).not.toContain('practices');

    const stemsCols = d.pragma('table_info(stems)') as { name: string }[];
    expect(stemsCols.map((c) => c.name)).toContain('project_id');
    expect(stemsCols.map((c) => c.name)).not.toContain('practice_id');

    const annCols = d.pragma('table_info(annotations)') as { name: string }[];
    expect(annCols.map((c) => c.name)).toContain('project_id');
    expect(annCols.map((c) => c.name)).not.toContain('practice_id');

    const indexes = d
      .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(indexes).not.toContain('idx_practices_band_recorded');
    expect(indexes).not.toContain('idx_stems_practice');
    expect(indexes).not.toContain('idx_annotations_practice_user');
    expect(indexes).not.toContain('idx_annotations_practice_start');

    const project = d.prepare('SELECT id, name FROM projects WHERE id = ?').get('p1') as
      | { id: string; name: string }
      | undefined;
    expect(project?.name).toBe('Old practice');

    const stem = d
      .prepare('SELECT id, project_id FROM stems WHERE id = ?')
      .get('s1') as { id: string; project_id: string } | undefined;
    expect(stem?.project_id).toBe('p1');

    const ann = d
      .prepare('SELECT id, project_id FROM annotations WHERE id = ?')
      .get('a1') as { id: string; project_id: string } | undefined;
    expect(ann?.project_id).toBe('p1');

    // FK still wired: deleting the project cascades to stems and annotations.
    d.prepare('DELETE FROM projects WHERE id = ?').run('p1');
    expect(
      (d.prepare('SELECT COUNT(*) AS c FROM stems').get() as { c: number }).c,
    ).toBe(0);
    expect(
      (d.prepare('SELECT COUNT(*) AS c FROM annotations').get() as { c: number })
        .c,
    ).toBe(0);

    d.close();
  });

  it('is a no-op when projects already exists', () => {
    const path = join(tmpDir, 'already-migrated.sqlite');
    const d = new Database(path);
    d.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY);
      CREATE TABLE practices (id TEXT PRIMARY KEY);
    `);

    dbMod.migrateLegacyPracticesTable(d);

    // Both still present — function bailed without altering anything.
    const tables = d
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain('projects');
    expect(tables).toContain('practices');

    d.close();
  });

  it('is a no-op on a fresh DB with no practices table', () => {
    const path = join(tmpDir, 'fresh.sqlite');
    const d = new Database(path);

    expect(() => dbMod.migrateLegacyPracticesTable(d)).not.toThrow();

    d.close();
  });
});
