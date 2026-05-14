import type { Database } from 'better-sqlite3';

function tableExists(db: Database, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { name: string } | undefined;
  return !!row;
}

function columnExists(db: Database, table: string, col: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === col);
}

// Drop the obsolete `drive_` prefix from band/project/stem storage-id columns,
// and strip the `local:` prefix from any rows that still have it. The repo no
// longer talks to Google Drive — storage ids are now bare base64url-encoded
// relative paths.
//
// Idempotent: renames only happen when the legacy column is still present;
// the `local:` strip is a no-op once values have already been normalized.
export function dropDriveColumnPrefixes(db: Database): void {
  if (tableExists(db, 'bands') && columnExists(db, 'bands', 'drive_folder_id')) {
    db.exec('ALTER TABLE bands RENAME COLUMN drive_folder_id TO folder_id');
  }
  if (tableExists(db, 'projects') && columnExists(db, 'projects', 'drive_folder_id')) {
    db.exec('ALTER TABLE projects RENAME COLUMN drive_folder_id TO folder_id');
  }
  if (tableExists(db, 'stems') && columnExists(db, 'stems', 'drive_file_id')) {
    db.exec('ALTER TABLE stems RENAME COLUMN drive_file_id TO file_id');
  }

  if (tableExists(db, 'bands') && columnExists(db, 'bands', 'folder_id')) {
    db.exec(
      `UPDATE bands SET folder_id = substr(folder_id, 7) WHERE folder_id LIKE 'local:%'`,
    );
  }
  if (tableExists(db, 'projects') && columnExists(db, 'projects', 'folder_id')) {
    db.exec(
      `UPDATE projects SET folder_id = substr(folder_id, 7) WHERE folder_id LIKE 'local:%'`,
    );
  }
  if (tableExists(db, 'stems') && columnExists(db, 'stems', 'file_id')) {
    db.exec(
      `UPDATE stems SET file_id = substr(file_id, 7) WHERE file_id LIKE 'local:%'`,
    );
  }
}
