import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';

describe('sessions schema migration', () => {
  it('adds label and last_used_at columns idempotently to a legacy sessions table', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    function columnExists(table: string, col: string): boolean {
      const rows = db
        .prepare(`PRAGMA table_info(${table})`)
        .all() as { name: string }[];
      return rows.some((r) => r.name === col);
    }
    if (!columnExists('sessions', 'label')) {
      db.exec('ALTER TABLE sessions ADD COLUMN label TEXT');
    }
    if (!columnExists('sessions', 'last_used_at')) {
      db.exec('ALTER TABLE sessions ADD COLUMN last_used_at INTEGER');
    }
    if (!columnExists('sessions', 'label')) {
      db.exec('ALTER TABLE sessions ADD COLUMN label TEXT');
    }
    expect(columnExists('sessions', 'label')).toBe(true);
    expect(columnExists('sessions', 'last_used_at')).toBe(true);
  });
});
