import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const databasePath = process.env.DATABASE_PATH ?? './dev.sqlite';

export const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

export type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  created_at: number;
};

export type MagicLinkRow = {
  token: string;
  email: string;
  expires_at: number;
  used_at: number | null;
};

export type SessionRow = {
  id: string;
  user_id: string;
  expires_at: number;
  created_at: number;
};

export const stmts = {
  findUserByEmail: db.prepare<[string], UserRow>(
    'SELECT * FROM users WHERE email = ?',
  ),
  findUserById: db.prepare<[string], UserRow>(
    'SELECT * FROM users WHERE id = ?',
  ),
  insertUser: db.prepare<[string, string, string | null, number]>(
    'INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)',
  ),
  upsertUser: db.prepare<[string, string, string | null, number]>(
    `INSERT INTO users (id, email, display_name, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       display_name = COALESCE(excluded.display_name, users.display_name)`,
  ),
  insertMagicLink: db.prepare<[string, string, number]>(
    'INSERT INTO magic_links (token, email, expires_at) VALUES (?, ?, ?)',
  ),
  consumeMagicLink: db.prepare<[string]>(
    `UPDATE magic_links
       SET used_at = strftime('%s','now')
     WHERE token = ?
       AND used_at IS NULL
       AND expires_at > strftime('%s','now')`,
  ),
  findMagicLink: db.prepare<[string], MagicLinkRow>(
    'SELECT * FROM magic_links WHERE token = ?',
  ),
  insertSession: db.prepare<[string, string, number, number]>(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ),
  findSessionWithUser: db.prepare<
    [string],
    UserRow & { session_id: string; session_expires_at: number }
  >(
    `SELECT u.id, u.email, u.display_name, u.created_at,
            s.id AS session_id, s.expires_at AS session_expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
  ),
  deleteSession: db.prepare<[string]>('DELETE FROM sessions WHERE id = ?'),
};
