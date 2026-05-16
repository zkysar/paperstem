CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS magic_links (
  token       TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email);

CREATE TABLE IF NOT EXISTS sessions (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at       INTEGER NOT NULL,
  created_at       INTEGER NOT NULL,
  label            TEXT,
  last_used_at     INTEGER,
  token_public_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_tokens
  ON sessions(user_id, created_at DESC) WHERE label IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_public_id
  ON sessions(token_public_id) WHERE token_public_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS bands (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  folder_id          TEXT NOT NULL,
  owner_user_id      TEXT NOT NULL REFERENCES users(id),
  created_at         INTEGER NOT NULL,
  last_snapshot_at   INTEGER,
  last_backup_at     INTEGER
);

CREATE TABLE IF NOT EXISTS memberships (
  band_id     TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner','member')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (band_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  band_id         TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  recorded_on     TEXT,
  folder_id       TEXT NOT NULL,
  notes           TEXT,
  created_at      INTEGER NOT NULL,
  created_by      TEXT NOT NULL REFERENCES users(id),
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER,
  deleted_by      TEXT REFERENCES users(id),
  deleted_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_band_recorded ON projects(band_id, recorded_on DESC);
CREATE INDEX IF NOT EXISTS idx_projects_band_recorded_live
  ON projects(band_id, recorded_on DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS stems (
  id             TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  position       INTEGER NOT NULL,
  file_id        TEXT NOT NULL,
  duration_ms    INTEGER,
  size_bytes     INTEGER,
  peaks          TEXT,
  deleted_at     INTEGER,
  deleted_by     TEXT REFERENCES users(id),
  deleted_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_stems_project ON stems(project_id, position);
CREATE INDEX IF NOT EXISTS idx_stems_project_live
  ON stems(project_id, position) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS annotations (
  id           TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_ms     INTEGER NOT NULL,
  end_ms       INTEGER,
  body         TEXT NOT NULL,
  starred      INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_annotations_project_user ON annotations(project_id, user_id);
CREATE INDEX IF NOT EXISTS idx_annotations_project_start ON annotations(project_id, start_ms);

CREATE TABLE IF NOT EXISTS annotation_replies (
  id            TEXT PRIMARY KEY,
  annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_annotation_replies_annotation
  ON annotation_replies(annotation_id, created_at);

CREATE TABLE IF NOT EXISTS annotation_reactions (
  annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (annotation_id, user_id, emoji)
);
-- No secondary index on annotation_id: the PK already covers prefix lookups
-- by (annotation_id) and (annotation_id, user_id). An earlier revision
-- created idx_annotation_reactions_annotation; drop it on existing DBs.
DROP INDEX IF EXISTS idx_annotation_reactions_annotation;

CREATE TABLE IF NOT EXISTS annotation_reply_reactions (
  reply_id      TEXT NOT NULL REFERENCES annotation_replies(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (reply_id, user_id, emoji)
);
-- No secondary index on reply_id: PK prefix lookups suffice.
DROP INDEX IF EXISTS idx_annotation_reply_reactions_reply;

-- Band-scoped song catalog backing the section chapter-lane and the
-- FilePicker chip-rail filter. Name is unique within a band on a normalised
-- (lower(trim(.))) key so the combobox at section-creation transparently
-- dedups "Heart Sounds" / "heart sounds" / "  Heart Sounds " into a single
-- row. The original casing the user typed survives in `name`; `name_norm`
-- is the dedup key only.
CREATE TABLE IF NOT EXISTS songs (
  id          TEXT PRIMARY KEY,
  band_id     TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  name_norm   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_songs_band_name_norm ON songs(band_id, name_norm);
CREATE INDEX IF NOT EXISTS idx_songs_band ON songs(band_id);

-- A timeline boundary on a project. Implicit end (= next section's
-- start_ms, or project duration). Exactly one of song_id / label is set
-- when the section is named; both NULL means an unnamed boundary (used by
-- the auto-detector — for v1 the manual flow only emits named sections).
CREATE TABLE IF NOT EXISTS sections (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  start_ms    INTEGER NOT NULL,
  song_id     TEXT REFERENCES songs(id) ON DELETE SET NULL,
  label       TEXT,
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto')),
  created_at  INTEGER NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id),
  updated_at  INTEGER NOT NULL,
  CHECK (NOT (song_id IS NOT NULL AND label IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_sections_project_start ON sections(project_id, start_ms);
CREATE INDEX IF NOT EXISTS idx_sections_song ON sections(song_id);

-- Append-only audit log for destructive operations on projects, stems, and
-- annotations. Records soft-deletes via routes plus hard-deletes from the
-- trash purge (where a CASCADE on projects wipes stem rows with no
-- deleted_by). user_id is intentionally NOT a foreign key — audit rows must
-- survive user deletion. resource_id is not a FK either, since the row it
-- describes is usually gone by the time you query the log.
CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  created_at    INTEGER NOT NULL,
  user_id       TEXT,
  user_email    TEXT,
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT NOT NULL,
  band_id       TEXT,
  metadata      TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource
  ON audit_log(resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_band
  ON audit_log(band_id, created_at DESC) WHERE band_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON audit_log(action, created_at DESC);

CREATE TABLE IF NOT EXISTS mentions (
  id              TEXT PRIMARY KEY,
  source_type     TEXT NOT NULL CHECK (source_type IN ('annotation','reply')),
  source_id       TEXT NOT NULL,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      INTEGER NOT NULL,
  read_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mentions_target_unread
  ON mentions(target_user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mentions_source ON mentions(source_type, source_id);

CREATE TABLE IF NOT EXISTS project_reads (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  last_read_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id)
);

-- Notifications are OFF for every user until they explicitly opt in via the
-- settings dialog. The defaults here apply to any future fresh database; the
-- JS fallback in src/server/notifications.ts (DEFAULT_PREFS) is what governs
-- existing users with no prefs row.
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id                 TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_mentions          INTEGER NOT NULL DEFAULT 0,
  email_project_activity  TEXT NOT NULL DEFAULT 'off'
    CHECK (email_project_activity IN ('batched','daily','off')),
  email_thread_activity   TEXT NOT NULL DEFAULT 'off'
    CHECK (email_thread_activity IN ('batched','daily','off')),
  digest_hour_local       INTEGER NOT NULL DEFAULT 8,
  timezone                TEXT NOT NULL DEFAULT 'UTC',
  updated_at              INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS band_mutes (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  band_id    TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  muted_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, band_id)
);

-- Per-project public-share links. A token resolves to exactly one project
-- and grants strictly read-only access to that project (and its stems /
-- annotations / sections) via /api/public/links/:token/*. There is no path
-- from a public token to any other project, to the project browser, or to
-- any write endpoint — handlers under /api/public never call requireUser
-- and never trust a session cookie.
CREATE TABLE IF NOT EXISTS public_links (
  token             TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at        INTEGER NOT NULL,
  revoked_at        INTEGER,
  -- 'user' (manual revoke from the admin UI) or 'trash' (auto-revoked
  -- because the project was soft-deleted). The distinction matters at
  -- restore time: only trash-revoked links re-activate when the project
  -- comes back. NULL only when revoked_at is NULL.
  revoked_reason    TEXT CHECK (revoked_reason IN ('user','trash')),
  last_accessed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_public_links_project
  ON public_links(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pending_notifications (
  id              TEXT PRIMARY KEY,
  recipient_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('comment','reply','mention','reaction')),
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_type     TEXT NOT NULL CHECK (source_type IN ('annotation','reply')),
  source_id       TEXT NOT NULL,
  author_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preview         TEXT NOT NULL,
  reply_token     TEXT,
  created_at      INTEGER NOT NULL,
  sent_at         INTEGER,
  send_attempts   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pending_notifications_unsent
  ON pending_notifications(recipient_id, created_at) WHERE sent_at IS NULL;
