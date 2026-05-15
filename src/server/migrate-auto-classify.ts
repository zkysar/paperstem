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

function indexExists(db: Database, name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
    .get(name) as { name: string } | undefined;
  return !!row;
}

// Auto-classification columns added to the existing `sections` table, plus
// the (project_id, source) index used by the "discard all auto sections in
// this project" lookup. The `song_fingerprints` and `classification_runs`
// tables are created by schema.sql (CREATE TABLE IF NOT EXISTS) — no
// migration needed for those.
//
// Runs before db.exec(schema) per the convention in db.ts: on a fresh
// install, sections doesn't exist yet and the early-return below is a
// no-op. The schema exec then creates sections with the columns; on the
// next boot the columnExists checks below confirm everything is in place.
export function migrateAutoClassify(db: Database): void {
  if (!tableExists(db, 'sections')) return;
  if (!columnExists(db, 'sections', 'confidence')) {
    db.exec('ALTER TABLE sections ADD COLUMN confidence REAL');
  }
  if (!columnExists(db, 'sections', 'run_id')) {
    db.exec('ALTER TABLE sections ADD COLUMN run_id TEXT');
  }
  if (!columnExists(db, 'sections', 'segment_type')) {
    db.exec('ALTER TABLE sections ADD COLUMN segment_type TEXT');
  }
  if (!columnExists(db, 'sections', 'top_classes_json')) {
    db.exec('ALTER TABLE sections ADD COLUMN top_classes_json TEXT');
  }
  if (!indexExists(db, 'idx_sections_project_source')) {
    db.exec('CREATE INDEX idx_sections_project_source ON sections(project_id, source)');
  }
}
