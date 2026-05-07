import { runSnapshotsNow } from './snapshots.js';
import { runBackupsNow } from './backups.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

const SNAPSHOT_HOUR_UTC = 3;
const BACKUP_HOUR_UTC = 4;
const BACKUP_DOW_UTC = 0;

export function msUntilNextDailyUtc(nowMs: number, hourUtc: number): number {
  const now = new Date(nowMs);
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hourUtc,
      0,
      0,
      0,
    ),
  );
  if (next.getTime() <= nowMs) {
    next.setTime(next.getTime() + DAY_MS);
  }
  return next.getTime() - nowMs;
}

export function msUntilNextWeeklyUtc(
  nowMs: number,
  dayOfWeekUtc: number,
  hourUtc: number,
): number {
  const now = new Date(nowMs);
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hourUtc,
      0,
      0,
      0,
    ),
  );
  const currentDow = now.getUTCDay();
  let daysUntil = (dayOfWeekUtc - currentDow + 7) % 7;
  if (daysUntil === 0 && next.getTime() <= nowMs) {
    daysUntil = 7;
  }
  next.setTime(next.getTime() + daysUntil * DAY_MS);
  if (next.getTime() <= nowMs) {
    next.setTime(next.getTime() + WEEK_MS);
  }
  return next.getTime() - nowMs;
}

let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let backupTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSnapshots(delayMs: number): void {
  snapshotTimer = setTimeout(() => {
    runSnapshotsNow()
      .catch((err) => console.error('[scheduler] snapshots run failed:', err))
      .finally(() => {
        scheduleSnapshots(DAY_MS);
      });
  }, delayMs);
  if (typeof snapshotTimer.unref === 'function') snapshotTimer.unref();
}

function scheduleBackups(delayMs: number): void {
  backupTimer = setTimeout(() => {
    runBackupsNow()
      .catch((err) => console.error('[scheduler] backups run failed:', err))
      .finally(() => {
        scheduleBackups(WEEK_MS);
      });
  }, delayMs);
  if (typeof backupTimer.unref === 'function') backupTimer.unref();
}

export function startScheduler(): void {
  const now = Date.now();
  const snapshotDelay = msUntilNextDailyUtc(now, SNAPSHOT_HOUR_UTC);
  const backupDelay = msUntilNextWeeklyUtc(now, BACKUP_DOW_UTC, BACKUP_HOUR_UTC);
  scheduleSnapshots(snapshotDelay);
  scheduleBackups(backupDelay);
  console.log(
    `[scheduler] next snapshot in ${Math.round(snapshotDelay / 1000)}s, ` +
      `next backup in ${Math.round(backupDelay / 1000)}s`,
  );
}

export function stopScheduler(): void {
  if (snapshotTimer) {
    clearTimeout(snapshotTimer);
    snapshotTimer = null;
  }
  if (backupTimer) {
    clearTimeout(backupTimer);
    backupTimer = null;
  }
}
