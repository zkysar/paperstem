import { stmts } from '../db.js';

const DEFAULT_RETENTION_DAYS = 365;
const DEFAULT_MAX_ROWS = 100_000;

export type AuditPruneOptions = {
  retentionDays?: number;
  maxRows?: number;
  nowSec?: number;
};

export type AuditPruneResult = {
  removed_by_age: number;
  removed_by_overflow: number;
  remaining: number;
  retention_days: number;
  max_rows: number;
};

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  return n;
}

export function runAuditPruneNow(opts: AuditPruneOptions = {}): AuditPruneResult {
  const retentionDays =
    opts.retentionDays ?? readEnvInt('AUDIT_LOG_RETENTION_DAYS', DEFAULT_RETENTION_DAYS);
  const maxRows = opts.maxRows ?? readEnvInt('AUDIT_LOG_MAX_ROWS', DEFAULT_MAX_ROWS);
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);

  let removedByAge = 0;
  if (retentionDays > 0) {
    const cutoff = nowSec - retentionDays * 24 * 60 * 60;
    removedByAge = Number(stmts.deleteAuditOlderThan.run(cutoff).changes);
  }

  let removedByOverflow = 0;
  if (maxRows > 0) {
    removedByOverflow = Number(stmts.trimAuditOverflow.run(maxRows).changes);
  }

  const remaining = stmts.countAuditLog.get()?.c ?? 0;

  const result: AuditPruneResult = {
    removed_by_age: removedByAge,
    removed_by_overflow: removedByOverflow,
    remaining,
    retention_days: retentionDays,
    max_rows: maxRows,
  };

  console.log(
    JSON.stringify({
      type: 'audit_prune',
      ts: nowSec,
      ...result,
    }),
  );

  return result;
}
