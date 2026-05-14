import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-schema-test-'));
const dbPath = join(tmpDir, 'pre-migration.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

describe('schema migration', () => {
  it('renames practices→projects, drops bpm + reference_stem, adds soft-delete columns', async () => {
    // Pre-seed a DB at the legacy schema (pre-rebrand): table is `practices`,
    // FK column is `practice_id`, and bpm/reference_stem still exist.
    const seed = new Database(dbPath);
    seed.exec(`
      CREATE TABLE practices (
        id TEXT PRIMARY KEY,
        band_id TEXT,
        name TEXT,
        recorded_on TEXT,
        drive_folder_id TEXT,
        bpm INTEGER,
        reference_stem TEXT,
        notes TEXT,
        created_at INTEGER,
        created_by TEXT,
        updated_at INTEGER
      );
      CREATE TABLE stems (
        id TEXT PRIMARY KEY,
        practice_id TEXT,
        name TEXT,
        position INTEGER,
        drive_file_id TEXT,
        duration_ms INTEGER,
        size_bytes INTEGER
      );
      INSERT INTO practices VALUES ('p1','b1','old','2025-01-01','f1',120,'click.wav','notes',1,'u1',1);
      INSERT INTO stems VALUES ('s1','p1','vocals.wav',0,'f-stem',1000,1234);
    `);
    seed.close();

    // Import db module — runs migration on load.
    const dbMod = await import('./db.js');

    // Legacy table is gone, new table exists.
    const tables = dbMod.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('projects');
    expect(tableNames).not.toContain('practices');

    const projectCols = dbMod.db
      .prepare(`PRAGMA table_info(projects)`)
      .all() as { name: string }[];
    const colNames = projectCols.map((c) => c.name);
    expect(colNames).not.toContain('bpm');
    expect(colNames).not.toContain('reference_stem');
    expect(colNames).toContain('deleted_at');
    expect(colNames).toContain('deleted_by');
    expect(colNames).toContain('deleted_reason');

    const stemCols = dbMod.db
      .prepare(`PRAGMA table_info(stems)`)
      .all() as { name: string }[];
    const stemColNames = stemCols.map((c) => c.name);
    expect(stemColNames).toContain('project_id');
    expect(stemColNames).not.toContain('practice_id');
    expect(stemColNames).toContain('deleted_at');
    expect(stemColNames).toContain('deleted_by');
    expect(stemColNames).toContain('deleted_reason');

    // Existing data preserved across the rename.
    const p = dbMod.db
      .prepare('SELECT name FROM projects WHERE id = ?')
      .get('p1') as { name: string };
    expect(p.name).toBe('old');
    const s = dbMod.db
      .prepare('SELECT project_id FROM stems WHERE id = ?')
      .get('s1') as { project_id: string };
    expect(s.project_id).toBe('p1');
  });
});
