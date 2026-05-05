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

export type BandRow = {
  id: string;
  name: string;
  drive_folder_id: string;
  owner_user_id: string;
  created_at: number;
  last_snapshot_at: number | null;
  last_backup_at: number | null;
};

export type MembershipRow = {
  band_id: string;
  user_id: string;
  role: 'owner' | 'member';
  created_at: number;
};

export type BandMemberRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'owner' | 'member';
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
  findBandById: db.prepare<[string], BandRow>(
    'SELECT * FROM bands WHERE id = ?',
  ),
  findBandsForUser: db.prepare<[string], BandRow & { role: 'owner' | 'member' }>(
    `SELECT b.*, m.role
       FROM bands b
       JOIN memberships m ON m.band_id = b.id
      WHERE m.user_id = ?
      ORDER BY b.name`,
  ),
  findMembershipsForBand: db.prepare<[string], BandMemberRow>(
    `SELECT u.id, u.email, u.display_name, m.role
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.band_id = ?
      ORDER BY m.role DESC, u.email`,
  ),
  findMembership: db.prepare<[string, string], MembershipRow>(
    'SELECT * FROM memberships WHERE band_id = ? AND user_id = ?',
  ),
  insertBand: db.prepare<[string, string, string, string, number]>(
    `INSERT INTO bands (id, name, drive_folder_id, owner_user_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ),
  insertMembership: db.prepare<[string, string, 'owner' | 'member', number]>(
    `INSERT INTO memberships (band_id, user_id, role, created_at)
     VALUES (?, ?, ?, ?)`,
  ),
  findBandByNameAndOwner: db.prepare<[string, string], BandRow>(
    'SELECT * FROM bands WHERE name = ? AND owner_user_id = ?',
  ),
};
