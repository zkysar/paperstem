// src/server/migrate-drive-columns.test.ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { dropDriveColumnPrefixes } from './migrate-drive-columns.js';

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (r) => r.name,
  );
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { name: string } | undefined;
  return !!row;
}

function seedPostRenameLegacy(db: Database.Database): void {
  // Schema as it exists after the practice→project rename but before this
  // migration: projects table, but `drive_folder_id` / `drive_file_id`
  // columns and `local:`-prefixed IDs still in use.
  db.exec(`
    CREATE TABLE bands (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      drive_folder_id TEXT NOT NULL,
      owner_user_id   TEXT NOT NULL,
      created_at      INTEGER NOT NULL
    );
    CREATE TABLE projects (
      id              TEXT PRIMARY KEY,
      band_id         TEXT NOT NULL,
      name            TEXT NOT NULL,
      drive_folder_id TEXT NOT NULL,
      created_at      INTEGER NOT NULL,
      created_by      TEXT NOT NULL,
      updated_at      INTEGER NOT NULL
    );
    CREATE TABLE stems (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL,
      name          TEXT NOT NULL,
      position      INTEGER NOT NULL,
      drive_file_id TEXT NOT NULL
    );

    INSERT INTO bands  VALUES ('b1','My Band','local:QmFuZA',          'u1', 1);
    INSERT INTO projects VALUES ('p1','b1','Practice','local:QmFuZC9Q', 1,'u1',1);
    INSERT INTO stems  VALUES ('s1','p1','vocals.wav',0,'local:QmFuZC9QL3ZvY2Fscy53YXY');
  `);
}

describe('dropDriveColumnPrefixes', () => {
  it('renames drive_folder_id → folder_id on bands and projects, drive_file_id → file_id on stems, and strips local: prefix', () => {
    const db = new Database(':memory:');
    seedPostRenameLegacy(db);

    dropDriveColumnPrefixes(db);

    expect(columnNames(db, 'bands')).toContain('folder_id');
    expect(columnNames(db, 'bands')).not.toContain('drive_folder_id');
    expect(columnNames(db, 'projects')).toContain('folder_id');
    expect(columnNames(db, 'projects')).not.toContain('drive_folder_id');
    expect(columnNames(db, 'stems')).toContain('file_id');
    expect(columnNames(db, 'stems')).not.toContain('drive_file_id');

    const b = db.prepare('SELECT folder_id FROM bands WHERE id = ?').get('b1') as {
      folder_id: string;
    };
    expect(b.folder_id).toBe('QmFuZA');

    const p = db.prepare('SELECT folder_id FROM projects WHERE id = ?').get('p1') as {
      folder_id: string;
    };
    expect(p.folder_id).toBe('QmFuZC9Q');

    const s = db.prepare('SELECT file_id FROM stems WHERE id = ?').get('s1') as {
      file_id: string;
    };
    expect(s.file_id).toBe('QmFuZC9QL3ZvY2Fscy53YXY');
  });

  it('is a no-op on an already-migrated DB (folder_id/file_id already exist)', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE bands     (id TEXT PRIMARY KEY, folder_id TEXT NOT NULL);
      CREATE TABLE projects  (id TEXT PRIMARY KEY, folder_id TEXT NOT NULL);
      CREATE TABLE stems     (id TEXT PRIMARY KEY, file_id   TEXT NOT NULL);
      INSERT INTO bands     VALUES ('b1','unchanged-folder');
      INSERT INTO projects  VALUES ('p1','unchanged-folder');
      INSERT INTO stems     VALUES ('s1','unchanged-file');
    `);

    expect(() => dropDriveColumnPrefixes(db)).not.toThrow();

    const b = db.prepare('SELECT folder_id FROM bands WHERE id = ?').get('b1') as {
      folder_id: string;
    };
    expect(b.folder_id).toBe('unchanged-folder');
  });

  it('is a no-op on a fresh DB with no relevant tables', () => {
    const db = new Database(':memory:');
    expect(() => dropDriveColumnPrefixes(db)).not.toThrow();
    expect(tableExists(db, 'bands')).toBe(false);
  });

  it('is idempotent when run repeatedly on a legacy DB', () => {
    const db = new Database(':memory:');
    seedPostRenameLegacy(db);

    dropDriveColumnPrefixes(db);
    dropDriveColumnPrefixes(db);
    dropDriveColumnPrefixes(db);

    expect(columnNames(db, 'bands')).toContain('folder_id');
    expect(columnNames(db, 'projects')).toContain('folder_id');
    expect(columnNames(db, 'stems')).toContain('file_id');
  });
});
