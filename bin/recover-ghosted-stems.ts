import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Buffer } from 'node:buffer';
import { db } from '../src/server/db.js';

// One-off recovery tool. Run after fixing on-disk paths so stem.file_id
// matches the real file again, then this script unghosts the row.
//
// Limitation: the file-presence check is path-only (existsSync + isFile),
// not content-identity. If someone re-uploaded a stem to the same path
// post-ghosting, this would unghost the original row pointing at the
// replacement file. Acceptable for one-off cleanup; if used again, audit
// the candidate list before --commit.
//
// Background: handleRenameStem / handleRenameProject historically renamed the
// on-disk file/folder but never updated stem.file_id / project.folder_id, so
// the next audio fetch 404'd and the row was auto-soft-deleted with
// deleted_reason='drive_missing' (see src/server/audio.ts:34). The handlers
// are now fixed (see same-PR diff); this script cleans up the existing
// casualties.
//
// Usage:
//   tsx bin/recover-ghosted-stems.ts                 # dry-run
//   tsx bin/recover-ghosted-stems.ts --commit        # apply
//   tsx bin/recover-ghosted-stems.ts --project <id>  # scope to one project

const { values } = parseArgs({
  options: {
    commit: { type: 'boolean', default: false },
    project: { type: 'string' },
  },
  strict: true,
});

const COMMIT = values.commit === true;
const PROJECT_ID = values.project?.trim() || null;

const audioRoot = process.env.PAPERSTEM_AUDIO_ROOT;
if (!audioRoot) {
  console.error('PAPERSTEM_AUDIO_ROOT is not set');
  process.exit(1);
}
const root = resolve(audioRoot);

function decodeId(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf8');
}

type Row = {
  id: string;
  project_id: string;
  name: string;
  file_id: string;
  project_name: string;
  band_name: string;
};

const sql = PROJECT_ID
  ? `SELECT s.id, s.project_id, s.name, s.file_id, p.name AS project_name, b.name AS band_name
       FROM stems s
       JOIN projects p ON p.id = s.project_id
       JOIN bands b ON b.id = p.band_id
      WHERE s.deleted_reason = 'drive_missing'
        AND s.project_id = ?`
  : `SELECT s.id, s.project_id, s.name, s.file_id, p.name AS project_name, b.name AS band_name
       FROM stems s
       JOIN projects p ON p.id = s.project_id
       JOIN bands b ON b.id = p.band_id
      WHERE s.deleted_reason = 'drive_missing'`;

const rows = (
  PROJECT_ID
    ? db.prepare(sql).all(PROJECT_ID)
    : db.prepare(sql).all()
) as Row[];

console.log(`scanning ${rows.length} drive_missing stem(s) [${COMMIT ? 'COMMIT' : 'DRY-RUN'}]`);

let recoverable = 0;
let stillMissing = 0;
const restore = db.prepare<[string]>(
  `UPDATE stems
      SET deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL
    WHERE id = ?`,
);

const tx = db.transaction((ids: string[]) => {
  for (const id of ids) restore.run(id);
});
const toRestore: string[] = [];

for (const row of rows) {
  const rel = decodeId(row.file_id);
  const abs = join(root, rel);
  let onDisk = false;
  let size = 0;
  if (existsSync(abs)) {
    try {
      const s = statSync(abs);
      if (s.isFile()) {
        onDisk = true;
        size = s.size;
      }
    } catch {
      /* ignore */
    }
  }
  const tag = onDisk ? `OK   (${size} bytes)` : 'MISS         ';
  console.log(
    `${tag}  ${row.band_name} / ${row.project_name} / ${row.name}  ←  ${rel}`,
  );
  if (onDisk) {
    recoverable++;
    toRestore.push(row.id);
  } else {
    stillMissing++;
  }
}

console.log('');
console.log(`recoverable (file present): ${recoverable}`);
console.log(`still missing:              ${stillMissing}`);

if (COMMIT && recoverable > 0) {
  tx(toRestore);
  console.log(`unghosted ${recoverable} row(s).`);
} else if (recoverable > 0) {
  console.log('dry-run — pass --commit to unghost the recoverable rows.');
}
