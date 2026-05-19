import { runSnapshotsNow } from './snapshots.js';
import { runBackupsNow } from './backups.js';
import { runDiskUsageCheckNow } from './disk-usage.js';
import { runAuditPruneNow } from './audit-prune.js';
import { runBatchedFlushNow, runDailyFlushNow } from './notifications-flush.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

const BATCHED_FLUSH_INTERVAL_MS = 5 * 60 * 1000;  // every 5 minutes
const DAILY_FLUSH_INTERVAL_MS = 60 * 60 * 1000;   // every hour
const FIRST_RUN_DELAY_MS = 30 * 1000;             // wait 30s after startup

const SNAPSHOT_HOUR_UTC = 3;
const BACKUP_HOUR_UTC = 4;
const BACKUP_DOW_UTC = 0;
const DISK_CHECK_HOUR_UTC = 5;
const AUDIT_PRUNE_HOUR_UTC = 2;

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
let diskCheckTimer: ReturnType<typeof setTimeout> | null = null;
let auditPruneTimer: ReturnType<typeof setTimeout> | null = null;
let batchedFlushTimer: ReturnType<typeof setTimeout> | null = null;
let dailyFlushTimer: ReturnType<typeof setTimeout> | null = null;

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

function scheduleDiskCheck(delayMs: number): void {
  diskCheckTimer = setTimeout(() => {
    runDiskUsageCheckNow()
      .catch((err) => console.error('[scheduler] disk check run failed:', err))
      .finally(() => {
        scheduleDiskCheck(DAY_MS);
      });
  }, delayMs);
  if (typeof diskCheckTimer.unref === 'function') diskCheckTimer.unref();
}

function scheduleAuditPrune(delayMs: number): void {
  auditPruneTimer = setTimeout(() => {
    try {
      runAuditPruneNow();
    } catch (err) {
      console.error('[scheduler] audit prune run failed:', err);
    }
    scheduleAuditPrune(DAY_MS);
  }, delayMs);
  if (typeof auditPruneTimer.unref === 'function') auditPruneTimer.unref();
}

function scheduleBatchedFlush(delayMs: number): void {
  batchedFlushTimer = setTimeout(() => {
    runBatchedFlushNow()
      .catch((err) => console.error('[scheduler] batched flush failed:', err))
      .finally(() => {
        scheduleBatchedFlush(BATCHED_FLUSH_INTERVAL_MS);
      });
  }, delayMs);
  if (typeof batchedFlushTimer.unref === 'function') batchedFlushTimer.unref();
}

function scheduleDailyFlush(delayMs: number): void {
  dailyFlushTimer = setTimeout(() => {
    runDailyFlushNow()
      .catch((err) => console.error('[scheduler] daily flush failed:', err))
      .finally(() => {
        scheduleDailyFlush(DAILY_FLUSH_INTERVAL_MS);
      });
  }, delayMs);
  if (typeof dailyFlushTimer.unref === 'function') dailyFlushTimer.unref();
}

export function startScheduler(): void {
  const now = Date.now();
  const snapshotDelay = msUntilNextDailyUtc(now, SNAPSHOT_HOUR_UTC);
  const backupDelay = msUntilNextWeeklyUtc(now, BACKUP_DOW_UTC, BACKUP_HOUR_UTC);
  const auditPruneDelay = msUntilNextDailyUtc(now, AUDIT_PRUNE_HOUR_UTC);
  scheduleSnapshots(snapshotDelay);
  scheduleBackups(backupDelay);
  scheduleAuditPrune(auditPruneDelay);
  scheduleBatchedFlush(FIRST_RUN_DELAY_MS);
  scheduleDailyFlush(FIRST_RUN_DELAY_MS);

  // statfs() reports stats for the filesystem containing the path, not the
  // directory. In dev, $PAPERSTEM_AUDIO_ROOT sits on the developer's main
  // disk, so the check would alert on laptop fullness rather than the prod
  // Fly volume it's meant to monitor.
  const runDiskCheck = process.env.NODE_ENV === 'production';
  const diskDelay = runDiskCheck ? msUntilNextDailyUtc(now, DISK_CHECK_HOUR_UTC) : 0;
  if (runDiskCheck) scheduleDiskCheck(diskDelay);

  console.log(
    `[scheduler] next snapshot in ${Math.round(snapshotDelay / 1000)}s, ` +
      `next backup in ${Math.round(backupDelay / 1000)}s, ` +
      `next disk check ${runDiskCheck ? `in ${Math.round(diskDelay / 1000)}s` : 'skipped (non-production)'}, ` +
      `next audit prune in ${Math.round(auditPruneDelay / 1000)}s, ` +
      `batched flush in ${FIRST_RUN_DELAY_MS / 1000}s, ` +
      `daily flush in ${FIRST_RUN_DELAY_MS / 1000}s`,
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
  if (diskCheckTimer) {
    clearTimeout(diskCheckTimer);
    diskCheckTimer = null;
  }
  if (auditPruneTimer) {
    clearTimeout(auditPruneTimer);
    auditPruneTimer = null;
  }
  if (batchedFlushTimer) {
    clearTimeout(batchedFlushTimer);
    batchedFlushTimer = null;
  }
  if (dailyFlushTimer) {
    clearTimeout(dailyFlushTimer);
    dailyFlushTimer = null;
  }
}
