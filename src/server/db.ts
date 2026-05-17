import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renamePracticesToProjects } from './migrate-rename.js';
import { dropDriveColumnPrefixes } from './migrate-drive-columns.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const databasePath = process.env.DATABASE_PATH ?? './dev.sqlite';

export const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');

// Idempotent migrations for existing databases. Each block is a no-op once applied.
// These run before the schema exec so partial indexes referencing the new columns
// don't fail against a pre-existing table that lacks them.
function tableExists(table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { name: string } | undefined;
  return !!row;
}
function columnExists(table: string, col: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === col);
}

renamePracticesToProjects(db);
dropDriveColumnPrefixes(db);

if (tableExists('projects')) {
  if (columnExists('projects', 'bpm')) {
    db.exec('ALTER TABLE projects DROP COLUMN bpm');
  }
  if (columnExists('projects', 'reference_stem')) {
    db.exec('ALTER TABLE projects DROP COLUMN reference_stem');
  }
}
for (const col of ['deleted_at', 'deleted_by', 'deleted_reason']) {
  const type = col === 'deleted_at' ? 'INTEGER' : 'TEXT';
  if (tableExists('projects') && !columnExists('projects', col)) {
    db.exec(`ALTER TABLE projects ADD COLUMN ${col} ${type}`);
  }
  if (tableExists('stems') && !columnExists('stems', col)) {
    db.exec(`ALTER TABLE stems ADD COLUMN ${col} ${type}`);
  }
  if (tableExists('bands') && !columnExists('bands', col)) {
    db.exec(`ALTER TABLE bands ADD COLUMN ${col} ${type}`);
  }
}
if (tableExists('stems') && !columnExists('stems', 'peaks')) {
  db.exec('ALTER TABLE stems ADD COLUMN peaks TEXT');
}
if (tableExists('public_links') && !columnExists('public_links', 'revoked_reason')) {
  db.exec('ALTER TABLE public_links ADD COLUMN revoked_reason TEXT');
}
if (tableExists('sessions')) {
  if (!columnExists('sessions', 'label')) {
    db.exec('ALTER TABLE sessions ADD COLUMN label TEXT');
  }
  if (!columnExists('sessions', 'last_used_at')) {
    db.exec('ALTER TABLE sessions ADD COLUMN last_used_at INTEGER');
  }
  if (!columnExists('sessions', 'token_public_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN token_public_id TEXT');
  }
}

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
  label: string | null;
  last_used_at: number | null;
};

export type TokenListRow = {
  id: string; // token_public_id (NOT the cookie/secret value)
  label: string;
  created_at: number;
  expires_at: number;
  last_used_at: number | null;
};

export type BandRow = {
  id: string;
  name: string;
  folder_id: string;
  owner_user_id: string;
  created_at: number;
  last_snapshot_at: number | null;
  last_backup_at: number | null;
  deleted_at: number | null;
  deleted_by: string | null;
  deleted_reason: string | null;
};

export type BandPurgePreviewRow = {
  id: string;
  name: string;
  folder_id: string;
  owner_user_id: string;
  deleted_at: number;
  deleted_by: string | null;
  deleted_reason: string | null;
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
  folder_id: string;
  notes: string | null;
  created_at: number;
  created_by: string;
  updated_at: number;
  deleted_at: number | null;
  deleted_by: string | null;
  deleted_reason: string | null;
};

export type StemRow = {
  id: string;
  project_id: string;
  name: string;
  position: number;
  file_id: string;
  duration_ms: number | null;
  size_bytes: number | null;
  peaks: string | null;
  deleted_at: number | null;
  deleted_by: string | null;
  deleted_reason: string | null;
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

export type AnnotationReplyRow = {
  id: string;
  annotation_id: string;
  user_id: string;
  body: string;
  created_at: number;
  updated_at: number;
};

export type AnnotationReplyJoinedRow = AnnotationReplyRow & {
  user_email: string;
  user_display_name: string | null;
};

export type ReactionRow = {
  user_id: string;
  emoji: string;
  created_at: number;
};

export type ReplyReactionRow = ReactionRow & { reply_id: string };

export type AnnotationReactionAggRow = {
  annotation_id: string;
  emoji: string;
  count: number;
  user_ids_json: string;        // JSON array string from SQLite
  reacted_by_self: number;       // 0/1
};

export type ReplyReactionAggRow = {
  reply_id: string;
  emoji: string;
  count: number;
  user_ids_json: string;
  reacted_by_self: number;
};

export type AnnotationReplyCountRow = {
  annotation_id: string;
  reply_count: number;
};

export type SongRow = {
  id: string;
  band_id: string;
  name: string;
  name_norm: string;
  created_at: number;
  created_by: string;
};

export type SongWithUseCountRow = SongRow & { use_count: number };

export type SectionRow = {
  id: string;
  project_id: string;
  start_ms: number;
  song_id: string | null;
  label: string | null;
  source: 'manual' | 'auto';
  created_at: number;
  created_by: string;
  updated_at: number;
};

export type SectionJoinedRow = SectionRow & {
  song_name: string | null;
};

export type AuditLogRow = {
  id: string;
  created_at: number;
  user_id: string | null;
  user_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  band_id: string | null;
  metadata: string | null;
};

export type ProjectPurgePreviewRow = {
  id: string;
  name: string;
  folder_id: string;
  deleted_at: number;
  deleted_by: string | null;
  deleted_reason: string | null;
};

export type StemPurgePreviewRow = {
  id: string;
  project_id: string;
  name: string;
  file_id: string;
  deleted_at: number | null;
  deleted_by: string | null;
  deleted_reason: string | null;
};

export type MentionRow = {
  id: string;
  source_type: 'annotation' | 'reply';
  source_id: string;
  project_id: string;
  author_user_id: string;
  target_user_id: string;
  created_at: number;
  read_at: number | null;
};

export type UnreadMentionJoinedRow = {
  id: string;
  project_id: string;
  source_type: 'annotation' | 'reply';
  source_id: string;
  author_user_id: string;
  created_at: number;
  project_name: string;
  author_display_name: string | null;
  author_email: string;
  body: string | null;
};

export type PendingNotificationRow = {
  id: string;
  recipient_id: string;
  kind: 'comment' | 'reply' | 'mention' | 'reaction';
  project_id: string;
  source_type: 'annotation' | 'reply';
  source_id: string;
  author_user_id: string;
  preview: string;
  reply_token: string | null;
  created_at: number;
  sent_at: number | null;
  send_attempts: number;
};

export type NotificationPrefsRow = {
  user_id: string;
  email_mentions: number;
  email_project_activity: 'batched' | 'daily' | 'off';
  email_thread_activity: 'batched' | 'daily' | 'off';
  digest_hour_local: number;
  timezone: string;
  updated_at: number;
};

export type BandWithMuteRow = { id: string; name: string; muted: number };

export type PublicLinkRow = {
  token: string;
  project_id: string;
  created_by_user_id: string;
  created_at: number;
  revoked_at: number | null;
  revoked_reason: 'user' | 'trash' | null;
  last_accessed_at: number | null;
};

export type PublicLinkJoinedRow = PublicLinkRow & {
  created_by_email: string;
};

export type ProjectUnreadRow = { project_id: string; band_id: string };

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
  listUserTokens: db.prepare<[string], TokenListRow>(
    `SELECT token_public_id AS id, label, created_at, expires_at, last_used_at
       FROM sessions
      WHERE user_id = ? AND label IS NOT NULL
      ORDER BY created_at DESC`,
  ),
  createToken: db.prepare<[string, string, string, string, number, number]>(
    `INSERT INTO sessions (id, user_id, label, token_public_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ),
  revokeToken: db.prepare<[string, string]>(
    `DELETE FROM sessions
      WHERE token_public_id = ? AND user_id = ? AND label IS NOT NULL`,
  ),
  touchSessionLastUsed: db.prepare<[number, string, number]>(
    `UPDATE sessions SET last_used_at = ?
       WHERE id = ?
         AND (last_used_at IS NULL OR last_used_at < ?)`,
  ),
  findBandById: db.prepare<[string], BandRow>(
    'SELECT * FROM bands WHERE id = ? AND deleted_at IS NULL',
  ),
  findBandAnyState: db.prepare<[string], BandRow>(
    'SELECT * FROM bands WHERE id = ?',
  ),
  findAllBands: db.prepare<[], BandRow>(
    'SELECT * FROM bands WHERE deleted_at IS NULL ORDER BY name',
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
      WHERE m.user_id = ? AND m.role = 'owner' AND b.deleted_at IS NULL
      ORDER BY b.name`,
  ),
  findBandsForUser: db.prepare<[string], BandRow & { role: 'owner' | 'member' }>(
    `SELECT b.*, m.role
       FROM bands b
       JOIN memberships m ON m.band_id = b.id
      WHERE m.user_id = ? AND b.deleted_at IS NULL
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
    'SELECT COUNT(*) AS c FROM stems WHERE project_id = ? AND deleted_at IS NULL',
  ),
  insertBand: db.prepare<[string, string, string, string, number]>(
    `INSERT INTO bands (id, name, folder_id, owner_user_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ),
  insertMembership: db.prepare<[string, string, 'owner' | 'member', number]>(
    `INSERT INTO memberships (band_id, user_id, role, created_at)
     VALUES (?, ?, ?, ?)`,
  ),
  deleteMembership: db.prepare<[string, string]>(
    `DELETE FROM memberships WHERE band_id = ? AND user_id = ?`,
  ),
  setBandOwner: db.prepare<[string, string]>(
    `UPDATE bands SET owner_user_id = ? WHERE id = ? AND deleted_at IS NULL`,
  ),
  setMembershipRole: db.prepare<['owner' | 'member', string, string]>(
    `UPDATE memberships SET role = ? WHERE band_id = ? AND user_id = ?`,
  ),
  renameBand: db.prepare<[string, string]>(
    `UPDATE bands SET name = ? WHERE id = ? AND deleted_at IS NULL`,
  ),
  findBandByNameAndOwner: db.prepare<[string, string], BandRow>(
    'SELECT * FROM bands WHERE name = ? AND owner_user_id = ? AND deleted_at IS NULL',
  ),
  // Used by the duplicate-name check at band create/rename: returns matching
  // bands regardless of soft-delete state, so a user can't create a NEW band
  // with the same name as a soft-deleted one whose audio folder (also named
  // after the band) still exists under PAPERSTEM_AUDIO_ROOT. Without this,
  // createFolder() — which is `mkdir -p` — would return the same folder_id,
  // and the eventual purge sweep would trash the new band's audio.
  findBandByNameAndOwnerAnyState: db.prepare<[string, string], BandRow>(
    'SELECT * FROM bands WHERE name = ? AND owner_user_id = ?',
  ),
  softDeleteBand: db.prepare<[number, string, string]>(
    `UPDATE bands
        SET deleted_at = ?, deleted_by = ?, deleted_reason = 'user'
      WHERE id = ? AND deleted_at IS NULL`,
  ),
  // Cascade soft-delete: every live project in this band gets the same
  // tombstone fields the per-project soft-delete sets, plus a distinct
  // `deleted_reason` so we can tell them apart from user-initiated project
  // deletes (matters for future restore logic; also matters for the audit
  // story since these rows weren't explicitly trashed by the user).
  softDeleteProjectsForBand: db.prepare<[number, string, string]>(
    `UPDATE projects
        SET deleted_at = ?, deleted_by = ?, deleted_reason = 'band_deleted'
      WHERE band_id = ? AND deleted_at IS NULL`,
  ),
  // Revoke every live public link belonging to projects in this band, in
  // one statement, so deleted-band audio stops being publicly streamable
  // the moment the owner clicks Delete (not 30 days later at purge).
  trashRevokePublicLinksForBand: db.prepare<[number, string]>(
    `UPDATE public_links
        SET revoked_at = ?, revoked_reason = 'trash'
      WHERE revoked_at IS NULL
        AND project_id IN (SELECT id FROM projects WHERE band_id = ?)`,
  ),
  findBandsToPurge: db.prepare<[number, number], BandPurgePreviewRow>(
    `SELECT id, name, folder_id, owner_user_id, deleted_at, deleted_by, deleted_reason
       FROM bands
      WHERE deleted_at IS NOT NULL AND deleted_at < ?
      LIMIT ?`,
  ),
  purgeBand: db.prepare<[string]>(
    'DELETE FROM bands WHERE id = ? AND deleted_at IS NOT NULL',
  ),
  findProjectById: db.prepare<[string], ProjectRow>(
    'SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL',
  ),
  findProjectsForBand: db.prepare<[string], ProjectRow>(
    `SELECT * FROM projects
      WHERE band_id = ? AND deleted_at IS NULL
      ORDER BY recorded_on DESC, created_at DESC`,
  ),
  findProjectsForBandWithRefStem: db.prepare<
    [string],
    ProjectRow & {
      stem_count: number;
      reference_stem_id: string | null;
      total_duration_ms: number | null;
      comment_count: number;
    }
  >(
    `SELECT p.*,
            (SELECT COUNT(*) FROM stems s
              WHERE s.project_id = p.id AND s.deleted_at IS NULL) AS stem_count,
            (SELECT s.id FROM stems s
              WHERE s.project_id = p.id AND s.deleted_at IS NULL
              ORDER BY s.position LIMIT 1) AS reference_stem_id,
            (SELECT MAX(s.duration_ms) FROM stems s
              WHERE s.project_id = p.id AND s.deleted_at IS NULL) AS total_duration_ms,
            (SELECT COUNT(*) FROM annotations a
              WHERE a.project_id = p.id) AS comment_count
       FROM projects p
      WHERE p.band_id = ? AND p.deleted_at IS NULL
      ORDER BY p.recorded_on DESC, p.created_at DESC`,
  ),
  findStemsForProject: db.prepare<[string], StemRow>(
    `SELECT s.* FROM stems s
       JOIN projects p ON p.id = s.project_id
      WHERE s.project_id = ?
        AND s.deleted_at IS NULL
        AND p.deleted_at IS NULL
      ORDER BY s.position`,
  ),
  findStemById: db.prepare<[string], StemRow>(
    'SELECT * FROM stems WHERE id = ? AND deleted_at IS NULL',
  ),
  findStemWithBandId: db.prepare<[string], StemWithBandRow>(
    `SELECT s.*, p.band_id
       FROM stems s
       JOIN projects p ON p.id = s.project_id
      WHERE s.id = ?
        AND s.deleted_at IS NULL
        AND p.deleted_at IS NULL`,
  ),
  insertProject: db.prepare<
    [string, string, string, string | null, string, string | null, number, string, number]
  >(
    `INSERT INTO projects
       (id, band_id, name, recorded_on, folder_id, notes, created_at, created_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  insertStem: db.prepare<
    [string, string, string, number, string, number | null, number | null, string | null]
  >(
    `INSERT INTO stems
       (id, project_id, name, position, file_id, duration_ms, size_bytes, peaks)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  updateStemPeaks: db.prepare<[string, string]>(
    `UPDATE stems SET peaks = ?
      WHERE id = ? AND deleted_at IS NULL`,
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
  countAnnotationsForProject: db.prepare<[string], { n: number }>(
    'SELECT COUNT(*) AS n FROM annotations WHERE project_id = ?',
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
  renameProject: db.prepare<[string, number, string]>(
    `UPDATE projects SET name = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL`,
  ),
  softDeleteProject: db.prepare<[number, string, string]>(
    `UPDATE projects
        SET deleted_at = ?, deleted_by = ?, deleted_reason = 'user'
      WHERE id = ? AND deleted_at IS NULL`,
  ),
  markProjectGhost: db.prepare<[number, string]>(
    `UPDATE projects
        SET deleted_at = ?, deleted_by = NULL, deleted_reason = 'drive_missing'
      WHERE id = ? AND deleted_at IS NULL`,
  ),
  restoreProject: db.prepare<[string]>(
    `UPDATE projects
        SET deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL
      WHERE id = ? AND deleted_reason != 'drive_missing'`,
  ),
  findProjectAnyState: db.prepare<[string], ProjectRow>(
    'SELECT * FROM projects WHERE id = ?',
  ),
  findTrashedProjectsForBand: db.prepare<
    [string],
    ProjectRow & { deleted_by_email: string | null }
  >(
    `SELECT p.*, u.email AS deleted_by_email
       FROM projects p
       LEFT JOIN users u ON u.id = p.deleted_by
      WHERE p.band_id = ? AND p.deleted_at IS NOT NULL
      ORDER BY p.deleted_at DESC`,
  ),
  purgeProjectsForBand: db.prepare<[string, number]>(
    'DELETE FROM projects WHERE band_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?',
  ),
  renameStem: db.prepare<[string, string]>(
    `UPDATE stems SET name = ?
      WHERE id = ? AND deleted_at IS NULL`,
  ),
  updateStemFileId: db.prepare<[string, string]>(
    `UPDATE stems SET file_id = ? WHERE id = ?`,
  ),
  updateProjectFolderId: db.prepare<[string, number, string]>(
    `UPDATE projects SET folder_id = ?, updated_at = ? WHERE id = ?`,
  ),
  softDeleteStem: db.prepare<[number, string, string]>(
    `UPDATE stems
        SET deleted_at = ?, deleted_by = ?, deleted_reason = 'user'
      WHERE id = ? AND deleted_at IS NULL`,
  ),
  markStemGhost: db.prepare<[number, string]>(
    `UPDATE stems
        SET deleted_at = ?, deleted_by = NULL, deleted_reason = 'drive_missing'
      WHERE id = ? AND deleted_at IS NULL`,
  ),
  restoreStem: db.prepare<[string]>(
    `UPDATE stems
        SET deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL
      WHERE id = ? AND deleted_reason != 'drive_missing'`,
  ),
  findStemAnyState: db.prepare<[string], StemRow & { band_id: string }>(
    `SELECT s.*, p.band_id
       FROM stems s
       JOIN projects p ON p.id = s.project_id
      WHERE s.id = ?`,
  ),
  findTrashedStemsForBand: db.prepare<
    [string],
    StemRow & { deleted_by_email: string | null; project_name: string }
  >(
    `SELECT s.*, u.email AS deleted_by_email, p.name AS project_name
       FROM stems s
       JOIN projects p ON p.id = s.project_id
       LEFT JOIN users u ON u.id = s.deleted_by
      WHERE p.band_id = ? AND s.deleted_at IS NOT NULL
      ORDER BY s.deleted_at DESC`,
  ),
  purgeStemsForBand: db.prepare<[string, number]>(
    `DELETE FROM stems
      WHERE project_id IN (SELECT id FROM projects WHERE band_id = ?)
        AND deleted_at IS NOT NULL AND deleted_at < ?`,
  ),
  findProjectsToPurge: db.prepare<[string, number], ProjectPurgePreviewRow>(
    `SELECT id, name, folder_id, deleted_at, deleted_by, deleted_reason
       FROM projects
      WHERE band_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?`,
  ),
  findStemsForProjectAnyState: db.prepare<[string], StemPurgePreviewRow>(
    `SELECT id, project_id, name, file_id, deleted_at, deleted_by, deleted_reason
       FROM stems WHERE project_id = ?`,
  ),
  findStemsToPurgeDirect: db.prepare<[string, number], StemPurgePreviewRow>(
    `SELECT s.id, s.project_id, s.name, s.file_id, s.deleted_at, s.deleted_by, s.deleted_reason
       FROM stems s
       JOIN projects p ON p.id = s.project_id
      WHERE p.band_id = ?
        AND s.deleted_at IS NOT NULL AND s.deleted_at < ?`,
  ),

  // --- replies ---
  findRepliesForAnnotation: db.prepare<[string], AnnotationReplyJoinedRow>(
    `SELECT r.id, r.annotation_id, r.user_id, r.body, r.created_at, r.updated_at,
            u.email AS user_email, u.display_name AS user_display_name
       FROM annotation_replies r
       JOIN users u ON u.id = r.user_id
      WHERE r.annotation_id = ?
      ORDER BY r.created_at ASC`,
  ),
  findReplyById: db.prepare<[string], AnnotationReplyRow>(
    'SELECT * FROM annotation_replies WHERE id = ?',
  ),
  findReplyByIdJoined: db.prepare<[string], AnnotationReplyJoinedRow>(
    `SELECT r.id, r.annotation_id, r.user_id, r.body, r.created_at, r.updated_at,
            u.email AS user_email, u.display_name AS user_display_name
       FROM annotation_replies r
       JOIN users u ON u.id = r.user_id
      WHERE r.id = ?`,
  ),
  insertReply: db.prepare<
    [string, string, string, string, number, number]
  >(
    `INSERT INTO annotation_replies
       (id, annotation_id, user_id, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ),
  updateReply: db.prepare<[string, number, string]>(
    `UPDATE annotation_replies SET body = ?, updated_at = ? WHERE id = ?`,
  ),
  deleteReply: db.prepare<[string]>(
    'DELETE FROM annotation_replies WHERE id = ?',
  ),
  countRepliesForProject: db.prepare<[string], AnnotationReplyCountRow>(
    `SELECT a.id AS annotation_id, COUNT(r.id) AS reply_count
       FROM annotations a
       LEFT JOIN annotation_replies r ON r.annotation_id = a.id
      WHERE a.project_id = ?
      GROUP BY a.id`,
  ),
  countRepliesForAnnotation: db.prepare<[string], { n: number }>(
    `SELECT COUNT(*) AS n FROM annotation_replies WHERE annotation_id = ?`,
  ),

  // --- reactions: comments ---
  findReactionsForProject: db.prepare<
    { project_id: string; user_id: string },
    AnnotationReactionAggRow
  >(
    `SELECT ar.annotation_id, ar.emoji,
            COUNT(*) AS count,
            json_group_array(ar.user_id ORDER BY ar.created_at, ar.user_id)
              AS user_ids_json,
            MAX(CASE WHEN ar.user_id = @user_id THEN 1 ELSE 0 END) AS reacted_by_self
       FROM annotation_reactions ar
       JOIN annotations a ON a.id = ar.annotation_id
      WHERE a.project_id = @project_id
      GROUP BY ar.annotation_id, ar.emoji
      ORDER BY ar.annotation_id, ar.emoji`,
  ),
  findReactionsForAnnotation: db.prepare<
    { annotation_id: string; user_id: string },
    AnnotationReactionAggRow
  >(
    `SELECT annotation_id, emoji,
            COUNT(*) AS count,
            json_group_array(user_id ORDER BY created_at, user_id)
              AS user_ids_json,
            MAX(CASE WHEN user_id = @user_id THEN 1 ELSE 0 END) AS reacted_by_self
       FROM annotation_reactions
      WHERE annotation_id = @annotation_id
      GROUP BY emoji
      ORDER BY emoji`,
  ),
  insertReaction: db.prepare<[string, string, string, number]>(
    `INSERT OR IGNORE INTO annotation_reactions
       (annotation_id, user_id, emoji, created_at)
     VALUES (?, ?, ?, ?)`,
  ),
  deleteReaction: db.prepare<[string, string, string]>(
    `DELETE FROM annotation_reactions
       WHERE annotation_id = ? AND user_id = ? AND emoji = ?`,
  ),

  // --- reactions: replies ---
  findReactionsForReplies: db.prepare<
    { annotation_id: string; user_id: string },
    ReplyReactionAggRow
  >(
    `SELECT rr.reply_id, rr.emoji,
            COUNT(*) AS count,
            json_group_array(rr.user_id ORDER BY rr.created_at, rr.user_id)
              AS user_ids_json,
            MAX(CASE WHEN rr.user_id = @user_id THEN 1 ELSE 0 END) AS reacted_by_self
       FROM annotation_reply_reactions rr
       JOIN annotation_replies r ON r.id = rr.reply_id
      WHERE r.annotation_id = @annotation_id
      GROUP BY rr.reply_id, rr.emoji
      ORDER BY rr.reply_id, rr.emoji`,
  ),
  findReactionsForReply: db.prepare<
    { reply_id: string; user_id: string },
    ReplyReactionAggRow
  >(
    `SELECT reply_id, emoji,
            COUNT(*) AS count,
            json_group_array(user_id ORDER BY created_at, user_id)
              AS user_ids_json,
            MAX(CASE WHEN user_id = @user_id THEN 1 ELSE 0 END) AS reacted_by_self
       FROM annotation_reply_reactions
      WHERE reply_id = @reply_id
      GROUP BY emoji
      ORDER BY emoji`,
  ),
  insertReplyReaction: db.prepare<[string, string, string, number]>(
    `INSERT OR IGNORE INTO annotation_reply_reactions
       (reply_id, user_id, emoji, created_at)
     VALUES (?, ?, ?, ?)`,
  ),
  deleteReplyReaction: db.prepare<[string, string, string]>(
    `DELETE FROM annotation_reply_reactions
       WHERE reply_id = ? AND user_id = ? AND emoji = ?`,
  ),

  // --- songs ---
  findSongById: db.prepare<[string], SongRow>(
    'SELECT * FROM songs WHERE id = ?',
  ),
  findSongByBandAndNameNorm: db.prepare<[string, string], SongRow>(
    'SELECT * FROM songs WHERE band_id = ? AND name_norm = ?',
  ),
  findSongsForBandWithUseCount: db.prepare<[string], SongWithUseCountRow>(
    `SELECT s.*,
            (SELECT COUNT(DISTINCT sec.project_id)
               FROM sections sec
               JOIN projects p ON p.id = sec.project_id
              WHERE sec.song_id = s.id AND p.deleted_at IS NULL) AS use_count
       FROM songs s
      WHERE s.band_id = ?
      ORDER BY use_count DESC, s.name COLLATE NOCASE ASC`,
  ),
  findSongByIdWithUseCount: db.prepare<[string], SongWithUseCountRow>(
    `SELECT s.*,
            (SELECT COUNT(DISTINCT sec.project_id)
               FROM sections sec
               JOIN projects p ON p.id = sec.project_id
              WHERE sec.song_id = s.id AND p.deleted_at IS NULL) AS use_count
       FROM songs s
      WHERE s.id = ?`,
  ),
  insertSong: db.prepare<[string, string, string, string, number, string]>(
    `INSERT INTO songs (id, band_id, name, name_norm, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ),
  renameSong: db.prepare<[string, string, string]>(
    `UPDATE songs SET name = ?, name_norm = ? WHERE id = ?`,
  ),
  deleteSong: db.prepare<[string]>('DELETE FROM songs WHERE id = ?'),
  repointSectionsToSong: db.prepare<[string, string]>(
    `UPDATE sections SET song_id = ?, updated_at = strftime('%s','now')
      WHERE song_id = ?`,
  ),

  // --- sections ---
  findSectionsForProject: db.prepare<[string], SectionJoinedRow>(
    `SELECT sec.id, sec.project_id, sec.start_ms, sec.song_id, sec.label,
            sec.source, sec.created_at, sec.created_by, sec.updated_at,
            song.name AS song_name
       FROM sections sec
       LEFT JOIN songs song ON song.id = sec.song_id
      WHERE sec.project_id = ?
      ORDER BY sec.start_ms ASC, sec.created_at ASC`,
  ),
  findSectionById: db.prepare<[string], SectionRow>(
    'SELECT * FROM sections WHERE id = ?',
  ),
  findSectionByIdJoined: db.prepare<[string], SectionJoinedRow>(
    `SELECT sec.id, sec.project_id, sec.start_ms, sec.song_id, sec.label,
            sec.source, sec.created_at, sec.created_by, sec.updated_at,
            song.name AS song_name
       FROM sections sec
       LEFT JOIN songs song ON song.id = sec.song_id
      WHERE sec.id = ?`,
  ),
  insertSection: db.prepare<
    [string, string, number, string | null, string | null, string, number, string, number]
  >(
    `INSERT INTO sections
       (id, project_id, start_ms, song_id, label, source, created_at, created_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  updateSection: db.prepare<[number, string | null, string | null, number, string]>(
    `UPDATE sections
        SET start_ms = ?, song_id = ?, label = ?, updated_at = ?
      WHERE id = ?`,
  ),
  deleteSection: db.prepare<[string]>('DELETE FROM sections WHERE id = ?'),
  findSongUsageForBand: db.prepare<[string], { project_id: string; song_id: string }>(
    `SELECT DISTINCT sec.project_id, sec.song_id
       FROM sections sec
       JOIN projects p ON p.id = sec.project_id
       JOIN songs song ON song.id = sec.song_id
      WHERE p.band_id = ? AND p.deleted_at IS NULL`,
  ),

  // --- audit log ---
  insertAuditLog: db.prepare<
    [string, number, string | null, string | null, string, string, string, string | null, string | null]
  >(
    `INSERT INTO audit_log
       (id, created_at, user_id, user_email, action, resource_type, resource_id, band_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  deleteAuditOlderThan: db.prepare<[number]>(
    'DELETE FROM audit_log WHERE created_at < ?',
  ),
  trimAuditOverflow: db.prepare<[number]>(
    `DELETE FROM audit_log
      WHERE id IN (
        SELECT id FROM audit_log
        ORDER BY created_at DESC, id DESC
        LIMIT -1 OFFSET ?
      )`,
  ),
  countAuditLog: db.prepare<[], { c: number }>(
    'SELECT COUNT(*) AS c FROM audit_log',
  ),

  // --- notifications: pending_notifications ---
  insertPendingNotification: db.prepare<
    [string, string, string, string, string, string, string, string, string | null, number]
  >(
    `INSERT INTO pending_notifications
       (id, recipient_id, kind, project_id, source_type, source_id, author_user_id, preview, reply_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  selectUnsentForRecipient: db.prepare<[string], PendingNotificationRow>(
    `SELECT * FROM pending_notifications
      WHERE recipient_id = ? AND sent_at IS NULL
      ORDER BY created_at ASC`,
  ),
  selectAllUnsent: db.prepare<[], PendingNotificationRow>(
    `SELECT * FROM pending_notifications
      WHERE sent_at IS NULL
      ORDER BY recipient_id, created_at ASC`,
  ),
  markPendingSent: db.prepare<[number, string]>(
    `UPDATE pending_notifications SET sent_at = ? WHERE id = ?`,
  ),
  bumpPendingAttempt: db.prepare<[string]>(
    `UPDATE pending_notifications SET send_attempts = send_attempts + 1 WHERE id = ?`,
  ),
  findPendingById: db.prepare<[string], PendingNotificationRow>(
    `SELECT * FROM pending_notifications WHERE id = ?`,
  ),
  findPendingByReplyToken: db.prepare<[string], PendingNotificationRow>(
    `SELECT * FROM pending_notifications WHERE reply_token = ? ORDER BY created_at DESC LIMIT 1`,
  ),

  // --- notifications: mentions ---
  insertMention: db.prepare<[string, string, string, string, string, string, number]>(
    `INSERT INTO mentions
       (id, source_type, source_id, project_id, author_user_id, target_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ),
  findUnreadMentionsForUser: db.prepare<[string], UnreadMentionJoinedRow>(
    `SELECT m.id, m.project_id, m.source_type, m.source_id, m.author_user_id, m.created_at,
            p.name AS project_name, u.display_name AS author_display_name, u.email AS author_email,
            COALESCE(a.body, r.body) AS body
       FROM mentions m
       JOIN projects p ON p.id = m.project_id
       JOIN users u ON u.id = m.author_user_id
       LEFT JOIN annotations a ON m.source_type = 'annotation' AND a.id = m.source_id
       LEFT JOIN annotation_replies r ON m.source_type = 'reply' AND r.id = m.source_id
      WHERE m.target_user_id = ? AND m.read_at IS NULL
      ORDER BY m.created_at DESC
      LIMIT 50`,
  ),
  markMentionRead: db.prepare<[number, string, string]>(
    `UPDATE mentions SET read_at = ? WHERE id = ? AND target_user_id = ? AND read_at IS NULL`,
  ),
  markMentionUnread: db.prepare<[string, string]>(
    `UPDATE mentions SET read_at = NULL WHERE id = ? AND target_user_id = ?`,
  ),
  markAllMentionsReadForUser: db.prepare<[number, string]>(
    `UPDATE mentions SET read_at = ? WHERE target_user_id = ? AND read_at IS NULL`,
  ),

  // --- notifications: project_reads ---
  upsertProjectRead: db.prepare<[string, string, number]>(
    `INSERT INTO project_reads (user_id, project_id, last_read_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, project_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
  ),
  findProjectRead: db.prepare<[string, string], { last_read_at: number }>(
    `SELECT last_read_at FROM project_reads WHERE user_id = ? AND project_id = ?`,
  ),

  // --- notifications: notification_prefs ---
  findNotificationPrefs: db.prepare<[string], NotificationPrefsRow>(
    `SELECT * FROM notification_prefs WHERE user_id = ?`,
  ),
  upsertNotificationPrefs: db.prepare<[string, number, string, string, number, string, number]>(
    `INSERT INTO notification_prefs
       (user_id, email_mentions, email_project_activity, email_thread_activity, digest_hour_local, timezone, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       email_mentions = excluded.email_mentions,
       email_project_activity = excluded.email_project_activity,
       email_thread_activity = excluded.email_thread_activity,
       digest_hour_local = excluded.digest_hour_local,
       timezone = excluded.timezone,
       updated_at = excluded.updated_at`,
  ),

  // --- notifications: band_mutes ---
  insertBandMute: db.prepare<[string, string, number]>(
    `INSERT OR IGNORE INTO band_mutes (user_id, band_id, muted_at) VALUES (?, ?, ?)`,
  ),
  deleteBandMute: db.prepare<[string, string]>(
    `DELETE FROM band_mutes WHERE user_id = ? AND band_id = ?`,
  ),
  findBandMute: db.prepare<[string, string], { one: number }>(
    `SELECT 1 AS one FROM band_mutes WHERE user_id = ? AND band_id = ? LIMIT 1`,
  ),
  findBandMutesForUser: db.prepare<[string], { band_id: string }>(
    `SELECT band_id FROM band_mutes WHERE user_id = ?`,
  ),

  // --- notifications: band roster / thread participant lookups ---
  findBandMemberIdsForProject: db.prepare<[string], { user_id: string }>(
    `SELECT m.user_id
       FROM memberships m
       JOIN projects p ON p.band_id = m.band_id
      WHERE p.id = ?`,
  ),
  findReplyParticipantsForAnnotation: db.prepare<[string], { user_id: string }>(
    `SELECT DISTINCT user_id FROM annotation_replies WHERE annotation_id = ?`,
  ),

  // --- notifications: unread project query ---
  // Named-param exception: user_id appears 4 times in subquery conditions; positional
  // would require passing it 4 times. Named params used for this statement only.
  selectProjectsWithUnreadForUser: db.prepare<
    { user_id: string },
    ProjectUnreadRow
  >(
    `SELECT DISTINCT p.id AS project_id, p.band_id
       FROM projects p
       JOIN memberships m ON m.band_id = p.band_id
       LEFT JOIN project_reads pr ON pr.user_id = m.user_id AND pr.project_id = p.id
      WHERE m.user_id = @user_id
        AND p.deleted_at IS NULL
        AND (
          EXISTS (SELECT 1 FROM annotations a WHERE a.project_id = p.id AND a.created_at > COALESCE(pr.last_read_at, 0))
          OR EXISTS (SELECT 1 FROM annotation_replies r JOIN annotations a ON a.id = r.annotation_id WHERE a.project_id = p.id AND r.created_at > COALESCE(pr.last_read_at, 0))
          OR EXISTS (SELECT 1 FROM annotation_reactions rx JOIN annotations a ON a.id = rx.annotation_id WHERE a.project_id = p.id AND a.user_id = @user_id AND rx.user_id != @user_id AND rx.created_at > COALESCE(pr.last_read_at, 0))
          OR EXISTS (SELECT 1 FROM annotation_reply_reactions rrx JOIN annotation_replies r ON r.id = rrx.reply_id JOIN annotations a ON a.id = r.annotation_id WHERE a.project_id = p.id AND r.user_id = @user_id AND rrx.user_id != @user_id AND rrx.created_at > COALESCE(pr.last_read_at, 0))
        )`,
  ),

  // --- presence ---
  findProjectMembership: db.prepare<[string, string], { band_id: string }>(
    `SELECT m.band_id FROM memberships m JOIN projects p ON p.band_id = m.band_id WHERE p.id = ? AND m.user_id = ?`,
  ),

  // --- public links ---
  // Resolve a token to its row regardless of revocation status; handlers
  // gate behaviour on revoked_at themselves so we can return a stable 410
  // for revoked tokens and 404 for unknown ones.
  findPublicLinkByToken: db.prepare<[string], PublicLinkRow>(
    `SELECT * FROM public_links WHERE token = ?`,
  ),
  findPublicLinksForProject: db.prepare<[string], PublicLinkJoinedRow>(
    `SELECT pl.*, u.email AS created_by_email
       FROM public_links pl
       LEFT JOIN users u ON u.id = pl.created_by_user_id
      WHERE pl.project_id = ?
      ORDER BY pl.created_at DESC`,
  ),
  insertPublicLink: db.prepare<[string, string, string, number]>(
    `INSERT INTO public_links (token, project_id, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?)`,
  ),
  revokePublicLink: db.prepare<[number, string]>(
    `UPDATE public_links SET revoked_at = ?, revoked_reason = 'user'
      WHERE token = ? AND revoked_at IS NULL`,
  ),
  // Called when a project is soft-deleted: every live link on it becomes
  // unusable. Trash-revoke is the only kind of revoke that's reversible
  // (via reactivatePublicLinksForTrashRestore) so it's tagged distinctly
  // to avoid resurrecting an explicitly-user-revoked link on restore.
  trashRevokePublicLinksForProject: db.prepare<[number, string]>(
    `UPDATE public_links
        SET revoked_at = ?, revoked_reason = 'trash'
      WHERE project_id = ? AND revoked_at IS NULL`,
  ),
  reactivatePublicLinksForTrashRestore: db.prepare<[string]>(
    `UPDATE public_links
        SET revoked_at = NULL, revoked_reason = NULL
      WHERE project_id = ? AND revoked_reason = 'trash'`,
  ),
  touchPublicLinkAccess: db.prepare<[number, string, number]>(
    `UPDATE public_links SET last_accessed_at = ?
       WHERE token = ?
         AND (last_accessed_at IS NULL OR last_accessed_at < ?)`,
  ),

  // --- notifications: bands with mute status (for settings dialog) ---
  // user_id passed twice: first for the EXISTS subquery, second for the membership filter.
  findBandsForUserWithMuteStatus: db.prepare<[string, string], BandWithMuteRow>(
    `SELECT b.id, b.name,
            EXISTS(SELECT 1 FROM band_mutes bm WHERE bm.user_id = ? AND bm.band_id = b.id) AS muted
       FROM bands b
       JOIN memberships m ON m.band_id = b.id
      WHERE m.user_id = ? AND b.deleted_at IS NULL
      ORDER BY b.name`,
  ),
};
