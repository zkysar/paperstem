import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { renamePracticesToProjects } from './migrate-rename.js';

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[]
  ).map((r) => r.name);
}

function indexNames(db: Database.Database): string[] {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' ORDER BY name`)
      .all() as { name: string }[]
  ).map((r) => r.name);
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (r) => r.name,
  );
}

function seedLegacy(db: Database.Database): void {
  // Approximates the schema as it existed before the practices→projects rebrand:
  // table `practices`, FK column `practice_id` on stems + annotations, and
  // the matching indexes.
  db.exec(`
    CREATE TABLE practices (
      id              TEXT PRIMARY KEY,
      band_id         TEXT NOT NULL,
      name            TEXT NOT NULL,
      recorded_on     TEXT,
      drive_folder_id TEXT NOT NULL,
      notes           TEXT,
      created_at      INTEGER NOT NULL,
      created_by      TEXT NOT NULL,
      updated_at      INTEGER NOT NULL,
      deleted_at      INTEGER,
      deleted_by      TEXT,
      deleted_reason  TEXT
    );
    CREATE INDEX idx_practices_band_recorded ON practices(band_id, recorded_on DESC);
    CREATE INDEX idx_practices_band_recorded_live
      ON practices(band_id, recorded_on DESC) WHERE deleted_at IS NULL;

    CREATE TABLE stems (
      id             TEXT PRIMARY KEY,
      practice_id    TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
      name           TEXT NOT NULL,
      position       INTEGER NOT NULL,
      drive_file_id  TEXT NOT NULL,
      duration_ms    INTEGER,
      size_bytes     INTEGER,
      peaks          TEXT,
      deleted_at     INTEGER,
      deleted_by     TEXT,
      deleted_reason TEXT
    );
    CREATE INDEX idx_stems_practice ON stems(practice_id, position);
    CREATE INDEX idx_stems_practice_live
      ON stems(practice_id, position) WHERE deleted_at IS NULL;

    CREATE TABLE annotations (
      id           TEXT PRIMARY KEY,
      practice_id  TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
      user_id      TEXT NOT NULL,
      start_ms     INTEGER NOT NULL,
      end_ms       INTEGER,
      body         TEXT NOT NULL,
      starred      INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX idx_annotations_practice_user ON annotations(practice_id, user_id);
    CREATE INDEX idx_annotations_practice_start ON annotations(practice_id, start_ms);

    INSERT INTO practices (id, band_id, name, drive_folder_id, created_at, created_by, updated_at)
      VALUES ('p1', 'b1', 'old session', 'f1', 1, 'u1', 1);
    INSERT INTO stems (id, practice_id, name, position, drive_file_id)
      VALUES ('s1', 'p1', 'vocals.wav', 0, 'f-stem');
    INSERT INTO annotations (id, practice_id, user_id, start_ms, body, created_at, updated_at)
      VALUES ('a1', 'p1', 'u1', 1500, 'note', 1, 1);
  `);
}

describe('renamePracticesToProjects', () => {
  it('renames a legacy DB: practices→projects, practice_id→project_id, drops stale indexes, preserves data', () => {
    const db = new Database(':memory:');
    seedLegacy(db);

    renamePracticesToProjects(db);

    const tables = tableNames(db);
    expect(tables).toContain('projects');
    expect(tables).not.toContain('practices');

    expect(columnNames(db, 'stems')).toContain('project_id');
    expect(columnNames(db, 'stems')).not.toContain('practice_id');
    expect(columnNames(db, 'annotations')).toContain('project_id');
    expect(columnNames(db, 'annotations')).not.toContain('practice_id');

    // The legacy indexes are dropped; the schema file recreates them under
    // the new names at boot, but the migration itself only drops.
    const indexes = indexNames(db);
    expect(indexes).not.toContain('idx_practices_band_recorded');
    expect(indexes).not.toContain('idx_practices_band_recorded_live');
    expect(indexes).not.toContain('idx_stems_practice');
    expect(indexes).not.toContain('idx_stems_practice_live');
    expect(indexes).not.toContain('idx_annotations_practice_user');
    expect(indexes).not.toContain('idx_annotations_practice_start');

    // Data preserved across the rename.
    const p = db
      .prepare('SELECT name FROM projects WHERE id = ?')
      .get('p1') as { name: string };
    expect(p.name).toBe('old session');
    const s = db
      .prepare('SELECT project_id FROM stems WHERE id = ?')
      .get('s1') as { project_id: string };
    expect(s.project_id).toBe('p1');
    const a = db
      .prepare('SELECT project_id FROM annotations WHERE id = ?')
      .get('a1') as { project_id: string };
    expect(a.project_id).toBe('p1');
  });

  it('is a no-op on an already-migrated DB (projects exists, practices does not)', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE stems (id TEXT PRIMARY KEY, project_id TEXT);
      CREATE TABLE annotations (id TEXT PRIMARY KEY, project_id TEXT);
      INSERT INTO projects VALUES ('p1', 'unchanged');
      INSERT INTO stems VALUES ('s1', 'p1');
    `);

    renamePracticesToProjects(db);

    const tables = tableNames(db);
    expect(tables).toContain('projects');
    expect(tables).not.toContain('practices');
    expect(columnNames(db, 'stems')).toContain('project_id');
    expect(columnNames(db, 'stems')).not.toContain('practice_id');

    const p = db
      .prepare('SELECT name FROM projects WHERE id = ?')
      .get('p1') as { name: string };
    expect(p.name).toBe('unchanged');
  });

  it('is a no-op on a fresh DB with no relevant tables', () => {
    const db = new Database(':memory:');

    expect(() => renamePracticesToProjects(db)).not.toThrow();

    expect(tableNames(db)).toEqual([]);
  });

  it('is idempotent when run repeatedly on a legacy DB', () => {
    const db = new Database(':memory:');
    seedLegacy(db);

    renamePracticesToProjects(db);
    renamePracticesToProjects(db);
    renamePracticesToProjects(db);

    expect(tableNames(db)).toContain('projects');
    expect(tableNames(db)).not.toContain('practices');
    expect(columnNames(db, 'stems')).toContain('project_id');
  });
});
