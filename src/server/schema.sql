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
