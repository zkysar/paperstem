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

export type ProjectRow = {
  id: string;
  band_id: string;
  name: string;
  recorded_on: string | null;
  drive_folder_id: string;
  bpm: number | null;
  reference_stem: string | null;
  notes: string | null;
  created_at: number;
  created_by: string;
  updated_at: number;
};

export type StemRow = {
  id: string;
  project_id: string;
  name: string;
  position: number;
  drive_file_id: string;
  duration_ms: number | null;
  size_bytes: number | null;
};

export type StemWithBandRow = StemRow & { band_id: string };

export type AnnotationRow = {
  id: string;
  project_id: string;
  user_id: string;
  start_ms: number;
  end_ms: number | null;
  body: string;
  starred: number;
  created_at: number;
  updated_at: number;
};

export type AnnotationJoinedRow = AnnotationRow & {
  user_email: string;
  user_display_name: string | null;
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
  findAllBands: db.prepare<[], BandRow>(
    'SELECT * FROM bands ORDER BY name',
  ),
  setBandLastSnapshotAt: db.prepare<[number, string]>(
    'UPDATE bands SET last_snapshot_at = ? WHERE id = ?',
  ),
  setBandLastBackupAt: db.prepare<[number, string]>(
    'UPDATE bands SET last_backup_at = ? WHERE id = ?',
  ),
  findOwnedBandsForUser: db.prepare<[string], BandRow>(
    `SELECT b.*
       FROM bands b
       JOIN memberships m ON m.band_id = b.id
      WHERE m.user_id = ? AND m.role = 'owner'
      ORDER BY b.name`,
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
  findOwnerMembership: db.prepare<[string, string], { one: number }>(
    `SELECT 1 AS one FROM memberships
      WHERE band_id = ? AND user_id = ? AND role = 'owner'`,
  ),
  countStemsForProject: db.prepare<[string], { c: number }>(
    'SELECT COUNT(*) AS c FROM stems WHERE project_id = ?',
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
  updateBandDriveFolder: db.prepare<[string, string]>(
    'UPDATE bands SET drive_folder_id = ? WHERE id = ?',
  ),
  findProjectById: db.prepare<[string], ProjectRow>(
    'SELECT * FROM projects WHERE id = ?',
  ),
  findProjectsForBand: db.prepare<[string], ProjectRow>(
    `SELECT * FROM projects
      WHERE band_id = ?
      ORDER BY recorded_on DESC, created_at DESC`,
  ),
  findStemsForProject: db.prepare<[string], StemRow>(
    'SELECT * FROM stems WHERE project_id = ? ORDER BY position',
  ),
  findStemById: db.prepare<[string], StemRow>(
    'SELECT * FROM stems WHERE id = ?',
  ),
  findStemWithBandId: db.prepare<[string], StemWithBandRow>(
    `SELECT s.*, p.band_id
       FROM stems s
       JOIN projects p ON p.id = s.project_id
      WHERE s.id = ?`,
  ),
  insertProject: db.prepare<
    [
      string,
      string,
      string,
      string | null,
      string,
      number | null,
      string | null,
      string | null,
      number,
      string,
      number,
    ]
  >(
    `INSERT INTO projects
       (id, band_id, name, recorded_on, drive_folder_id, bpm, reference_stem, notes, created_at, created_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  insertStem: db.prepare<
    [string, string, string, number, string, number | null, number | null]
  >(
    `INSERT INTO stems
       (id, project_id, name, position, drive_file_id, duration_ms, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ),
  findAnnotationsForProject: db.prepare<[string], AnnotationJoinedRow>(
    `SELECT a.id, a.project_id, a.user_id, a.start_ms, a.end_ms, a.body,
            a.starred, a.created_at, a.updated_at,
            u.email AS user_email, u.display_name AS user_display_name
       FROM annotations a
       JOIN users u ON u.id = a.user_id
      WHERE a.project_id = ?
      ORDER BY a.start_ms ASC, a.created_at ASC`,
  ),
  findAnnotationById: db.prepare<[string], AnnotationRow>(
    'SELECT * FROM annotations WHERE id = ?',
  ),
  findAnnotationByIdJoined: db.prepare<[string], AnnotationJoinedRow>(
    `SELECT a.id, a.project_id, a.user_id, a.start_ms, a.end_ms, a.body,
            a.starred, a.created_at, a.updated_at,
            u.email AS user_email, u.display_name AS user_display_name
       FROM annotations a
       JOIN users u ON u.id = a.user_id
      WHERE a.id = ?`,
  ),
  insertAnnotation: db.prepare<
    [
      string,
      string,
      string,
      number,
      number | null,
      string,
      number,
      number,
      number,
    ]
  >(
    `INSERT INTO annotations
       (id, project_id, user_id, start_ms, end_ms, body, starred, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  updateAnnotation: db.prepare<
    [number, number | null, string, number, number, string]
  >(
    `UPDATE annotations
        SET start_ms = ?, end_ms = ?, body = ?, starred = ?, updated_at = ?
      WHERE id = ?`,
  ),
  deleteAnnotation: db.prepare<[string]>(
    'DELETE FROM annotations WHERE id = ?',
  ),
};
