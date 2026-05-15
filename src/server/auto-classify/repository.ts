import type { Database } from 'better-sqlite3';
import type { ClassificationRun } from '../../shared/types.js';

export type FingerprintRow = {
  id: string;
  band_id: string;
  song_id: string;
  section_id: string;
  fingerprint_blob: Buffer;
  fingerprint_version: number;
  duration_ms: number;
  created_at: number;
};

export function insertFingerprint(db: Database, row: FingerprintRow): void {
  db.prepare(
    `INSERT INTO song_fingerprints
       (id, band_id, song_id, section_id, fingerprint_blob, fingerprint_version, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.band_id,
    row.song_id,
    row.section_id,
    row.fingerprint_blob,
    row.fingerprint_version,
    row.duration_ms,
    row.created_at,
  );
}

export function listFingerprintsForBand(db: Database, band_id: string): FingerprintRow[] {
  return db
    .prepare(`SELECT * FROM song_fingerprints WHERE band_id = ? ORDER BY created_at`)
    .all(band_id) as FingerprintRow[];
}

export function listFingerprintsForSong(
  db: Database,
  band_id: string,
  song_id: string,
): FingerprintRow[] {
  return db
    .prepare(`SELECT * FROM song_fingerprints WHERE band_id = ? AND song_id = ? ORDER BY created_at`)
    .all(band_id, song_id) as FingerprintRow[];
}

export function insertClassificationRun(db: Database, run: ClassificationRun): void {
  db.prepare(
    `INSERT INTO classification_runs
       (id, project_id, status, source_surface, audio_hash, classifier_version, fingerprint_version, error, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    run.id,
    run.project_id,
    run.status,
    run.source_surface,
    run.audio_hash,
    run.classifier_version,
    run.fingerprint_version,
    run.error,
    run.created_at,
    run.completed_at,
  );
}

export function updateClassificationRunStatus(
  db: Database,
  id: string,
  status: ClassificationRun['status'],
  opts: { completed_at: number | null; error: string | null },
): void {
  db.prepare(
    `UPDATE classification_runs SET status = ?, completed_at = ?, error = ? WHERE id = ?`,
  ).run(status, opts.completed_at, opts.error, id);
}
