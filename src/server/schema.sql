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
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS bands (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  drive_folder_id    TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS practices (
  id              TEXT PRIMARY KEY,
  band_id         TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  recorded_on     TEXT,
  drive_folder_id TEXT NOT NULL,
  bpm             INTEGER,
  reference_stem  TEXT,
  notes           TEXT,
  created_at      INTEGER NOT NULL,
  created_by      TEXT NOT NULL REFERENCES users(id),
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_practices_band_recorded ON practices(band_id, recorded_on DESC);

CREATE TABLE IF NOT EXISTS stems (
  id            TEXT PRIMARY KEY,
  practice_id   TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  position      INTEGER NOT NULL,
  drive_file_id TEXT NOT NULL,
  duration_ms   INTEGER,
  size_bytes    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_stems_practice ON stems(practice_id, position);
