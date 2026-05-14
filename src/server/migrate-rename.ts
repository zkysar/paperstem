import type { Database } from 'better-sqlite3';

function tableExists(db: Database, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { name: string } | undefined;
  return !!row;
}

function columnExists(db: Database, table: string, col: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === col);
}

// Rebrand: "practices" → "projects". Detect a legacy DB (has the old
// `practices` table and no new `projects` table) and rename in place. Drop
// now-stale indexes; the canonical schema recreates them under new names.
// Idempotent: legacy DB renames once; already-migrated and fresh DBs no-op.
export function renamePracticesToProjects(db: Database): void {
  if (!tableExists(db, 'practices') || tableExists(db, 'projects')) return;

  db.exec('ALTER TABLE practices RENAME TO projects');
  if (columnExists(db, 'stems', 'practice_id')) {
    db.exec('ALTER TABLE stems RENAME COLUMN practice_id TO project_id');
  }
  if (columnExists(db, 'annotations', 'practice_id')) {
    db.exec('ALTER TABLE annotations RENAME COLUMN practice_id TO project_id');
  }
  db.exec('DROP INDEX IF EXISTS idx_practices_band_recorded');
  db.exec('DROP INDEX IF EXISTS idx_practices_band_recorded_live');
  db.exec('DROP INDEX IF EXISTS idx_stems_practice');
  db.exec('DROP INDEX IF EXISTS idx_stems_practice_live');
  db.exec('DROP INDEX IF EXISTS idx_annotations_practice_user');
  db.exec('DROP INDEX IF EXISTS idx_annotations_practice_start');
}
