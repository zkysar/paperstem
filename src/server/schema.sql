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
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  start_ms          INTEGER NOT NULL,
  song_id           TEXT REFERENCES songs(id) ON DELETE SET NULL,
  label             TEXT,
  source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto')),
  created_at        INTEGER NOT NULL,
  created_by        TEXT NOT NULL REFERENCES users(id),
  updated_at        INTEGER NOT NULL,
  -- Auto-classification fields (NULL for manual sections). migrate-auto-classify.ts
  -- adds these to pre-existing tables on older databases.
  confidence        REAL,
  run_id            TEXT,
  segment_type      TEXT,
  top_classes_json  TEXT,
  CHECK (NOT (song_id IS NOT NULL AND label IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_sections_project_start ON sections(project_id, start_ms);
CREATE INDEX IF NOT EXISTS idx_sections_song ON sections(song_id);

-- Per-rendition chroma fingerprints for auto-classification song matching.
-- Populated when a section is manually labeled (or auto-section is accepted)
-- with a song_id; the matcher (auto-classify routes) queries these to
-- identify same-song-played-before across practices.
CREATE TABLE IF NOT EXISTS song_fingerprints (
  id                   TEXT PRIMARY KEY,
  band_id              TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  song_id              TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  section_id           TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  fingerprint_blob     BLOB NOT NULL,
  fingerprint_version  INTEGER NOT NULL,
  duration_ms          INTEGER NOT NULL,
  created_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fp_band_song ON song_fingerprints(band_id, song_id);
CREATE INDEX IF NOT EXISTS idx_fp_section ON song_fingerprints(section_id);

-- One row per "Auto-section this practice" invocation. Sections produced
-- by the run live in the sections table with run_id set; this table is the
-- history record only.
CREATE TABLE IF NOT EXISTS classification_runs (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status               TEXT NOT NULL CHECK (status IN ('pending','running','done','failed')),
  source_surface       TEXT NOT NULL CHECK (source_surface IN ('web','cli')),
  audio_hash           TEXT NOT NULL,
  classifier_version   TEXT NOT NULL,
  fingerprint_version  INTEGER NOT NULL,
  error                TEXT,
  created_at           INTEGER NOT NULL,
  completed_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_runs_project ON classification_runs(project_id, created_at);

-- Auto-classification columns on the sections table (confidence, run_id,
-- segment_type, top_classes_json) are added by migrate-auto-classify.ts —
-- which runs on every boot, so fresh installs get them too. The index
-- below is in schema.sql for fresh installs; the migration also creates it
-- idempotently for older databases.
CREATE INDEX IF NOT EXISTS idx_sections_project_source ON sections(project_id, source);

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
