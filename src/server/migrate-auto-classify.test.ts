import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateAutoClassify } from './migrate-auto-classify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function freshDb(): DatabaseType {
  const db = new Database(':memory:');
  db.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf-8'));
  return db;
}

function columnNames(db: DatabaseType, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
}

function indexExists(db: DatabaseType, name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
    .get(name) as { name: string } | undefined;
  return !!row;
}

describe('migrateAutoClassify', () => {
  it('adds confidence, run_id, segment_type, top_classes_json columns to sections', () => {
    const db = freshDb();
    migrateAutoClassify(db);
    const cols = columnNames(db, 'sections');
    expect(cols).toContain('confidence');
    expect(cols).toContain('run_id');
    expect(cols).toContain('segment_type');
    expect(cols).toContain('top_classes_json');
  });

  it('creates idx_sections_project_source if missing', () => {
    const db = freshDb();
    db.exec('DROP INDEX IF EXISTS idx_sections_project_source');
    expect(indexExists(db, 'idx_sections_project_source')).toBe(false);
    migrateAutoClassify(db);
    expect(indexExists(db, 'idx_sections_project_source')).toBe(true);
  });

  it('is idempotent — second invocation is a no-op', () => {
    const db = freshDb();
    migrateAutoClassify(db);
    expect(() => migrateAutoClassify(db)).not.toThrow();
    const cols = columnNames(db, 'sections');
    expect(cols).toContain('confidence');
  });

  it('works on a DB missing all four new columns (simulating an older DB)', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, created_at INTEGER);
      CREATE TABLE bands (id TEXT PRIMARY KEY, name TEXT, folder_id TEXT, owner_user_id TEXT, created_at INTEGER);
      CREATE TABLE songs (id TEXT PRIMARY KEY, band_id TEXT, name TEXT, created_at INTEGER);
      CREATE TABLE projects (id TEXT PRIMARY KEY, band_id TEXT, name TEXT, folder_id TEXT, created_at INTEGER, created_by TEXT);
      CREATE TABLE sections (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        song_id TEXT,
        label TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    migrateAutoClassify(db);
    const cols = columnNames(db, 'sections');
    expect(cols).toContain('confidence');
    expect(cols).toContain('run_id');
    expect(cols).toContain('segment_type');
    expect(cols).toContain('top_classes_json');
    expect(indexExists(db, 'idx_sections_project_source')).toBe(true);
  });
});
