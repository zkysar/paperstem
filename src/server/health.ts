import type { Context } from 'hono';
import { stmts } from './db.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';

const SNAPSHOT_STALE_AFTER_SEC = 36 * 60 * 60;
const BACKUP_STALE_AFTER_SEC = 8 * 24 * 60 * 60;

export function handleSnapshotsHealth(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const owned = stmts.findOwnedBandsForUser.all(user.id);
  if (owned.length === 0) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const bands = owned.map((b) => {
    const snapshotAge =
      b.last_snapshot_at != null ? nowSec - b.last_snapshot_at : null;
    const backupAge =
      b.last_backup_at != null ? nowSec - b.last_backup_at : null;
    return {
      id: b.id,
      name: b.name,
      last_snapshot_at: b.last_snapshot_at,
      last_backup_at: b.last_backup_at,
      snapshot_age_seconds: snapshotAge,
      backup_age_seconds: backupAge,
      snapshot_stale:
        snapshotAge === null || snapshotAge > SNAPSHOT_STALE_AFTER_SEC,
      backup_stale: backupAge === null || backupAge > BACKUP_STALE_AFTER_SEC,
    };
  });
  return c.json({ now: nowSec, bands });
}
