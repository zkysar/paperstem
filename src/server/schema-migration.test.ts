import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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

  it('creates reply and reaction tables', async () => {
    const dbMod = await import('./db.js');
    const tables = dbMod.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?,?)",
      )
      .all(
        'annotation_replies',
        'annotation_reactions',
        'annotation_reply_reactions',
      );
    expect(tables.length).toBe(3);
  });

  it('cascades replies and reactions when annotation is deleted', async () => {
    const dbMod = await import('./db.js');

    function createUser(email: string): string {
      const id = randomUUID();
      dbMod.stmts.insertUser.run(id, email, null, Math.floor(Date.now() / 1000));
      return id;
    }

    function createBand(ownerId: string): string {
      const id = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      dbMod.stmts.insertBand.run(id, 'Alpha', 'folder-x', ownerId, now);
      dbMod.stmts.insertMembership.run(id, ownerId, 'owner', now);
      return id;
    }

    function insertProject(bandId: string, userId: string): string {
      const id = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      dbMod.stmts.insertProject.run(
        id,
        bandId,
        'p1',
        null,
        'project-folder',
        null,
        now,
        userId,
        now,
      );
      return id;
    }

    function insertAnnotation(
      projectId: string,
      userId: string,
      startMs: number,
      endMs: number | null,
      body: string,
    ): string {
      const id = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      dbMod.stmts.insertAnnotation.run(
        id,
        projectId,
        userId,
        startMs,
        endMs,
        body,
        0,
        now,
        now,
      );
      return id;
    }

    const userId = createUser('u@e.test');
    const bandId = createBand(userId);
    const projectId = insertProject(bandId, userId);
    const annId = insertAnnotation(projectId, userId, 0, null, 'parent');

    dbMod.db
      .prepare(
        'INSERT INTO annotation_replies (id, annotation_id, user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('r1', annId, userId, 'hi', 1, 1);
    dbMod.db
      .prepare(
        'INSERT INTO annotation_reactions (annotation_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(annId, userId, '👍', 1);
    dbMod.db
      .prepare(
        'INSERT INTO annotation_reply_reactions (reply_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)',
      )
      .run('r1', userId, '🎵', 1);

    dbMod.stmts.deleteAnnotation.run(annId);

    expect(
      dbMod.db.prepare('SELECT COUNT(*) AS n FROM annotation_replies').get(),
    ).toEqual({ n: 0 });
    expect(
      dbMod.db.prepare('SELECT COUNT(*) AS n FROM annotation_reactions').get(),
    ).toEqual({ n: 0 });
    expect(
      dbMod.db
        .prepare('SELECT COUNT(*) AS n FROM annotation_reply_reactions')
        .get(),
    ).toEqual({ n: 0 });
  });
});
