import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-audit-prune-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('../db.js');
type AuditPruneModule = typeof import('./audit-prune.js');

let dbMod: DbModule;
let pruneMod: AuditPruneModule;

beforeAll(async () => {
  dbMod = await import('../db.js');
  pruneMod = await import('./audit-prune.js');
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  dbMod.db.exec('DELETE FROM audit_log;');
  delete process.env.AUDIT_LOG_RETENTION_DAYS;
  delete process.env.AUDIT_LOG_MAX_ROWS;
  vi.restoreAllMocks();
}

beforeEach(() => {
  reset();
});

function seedAudit(createdAt: number): string {
  const id = randomUUID();
  dbMod.stmts.insertAuditLog.run(
    id,
    createdAt,
    null,
    null,
    'project.soft_delete',
    'project',
    randomUUID(),
    null,
    null,
  );
  return id;
}

function rowCount(): number {
  return dbMod.stmts.countAuditLog.get()?.c ?? 0;
}

describe('runAuditPruneNow', () => {
  it('removes rows older than the retention window and keeps recent ones', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const now = 1_700_000_000;
    const day = 86_400;

    // 5 old (> 365 days), 3 recent
    for (let i = 0; i < 5; i++) seedAudit(now - 400 * day - i);
    for (let i = 0; i < 3; i++) seedAudit(now - i * day);

    const result = pruneMod.runAuditPruneNow({
      retentionDays: 365,
      maxRows: 100_000,
      nowSec: now,
    });

    expect(result.removed_by_age).toBe(5);
    expect(result.removed_by_overflow).toBe(0);
    expect(result.remaining).toBe(3);
    expect(rowCount()).toBe(3);
  });

  it('trims overflow beyond maxRows, keeping the newest', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const now = 1_700_000_000;
    const newestIds: string[] = [];
    // 20 rows, all within retention; cap to 5 — should keep the 5 newest.
    for (let i = 0; i < 20; i++) {
      const id = seedAudit(now - (20 - i)); // newer ids have larger created_at
      newestIds.push(id);
    }
    const expectedKept = newestIds.slice(15).sort();

    const result = pruneMod.runAuditPruneNow({
      retentionDays: 365,
      maxRows: 5,
      nowSec: now,
    });

    expect(result.removed_by_age).toBe(0);
    expect(result.removed_by_overflow).toBe(15);
    expect(result.remaining).toBe(5);

    const kept = (dbMod.db.prepare('SELECT id FROM audit_log').all() as { id: string }[])
      .map((r) => r.id)
      .sort();
    expect(kept).toEqual(expectedKept);
  });

  it('applies age prune before overflow trim', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const now = 1_700_000_000;
    const day = 86_400;
    for (let i = 0; i < 10; i++) seedAudit(now - 500 * day - i); // all expired
    for (let i = 0; i < 7; i++) seedAudit(now - i * day); // 7 recent

    const result = pruneMod.runAuditPruneNow({
      retentionDays: 365,
      maxRows: 3,
      nowSec: now,
    });

    expect(result.removed_by_age).toBe(10);
    expect(result.removed_by_overflow).toBe(4); // 7 recent - 3 kept
    expect(result.remaining).toBe(3);
  });

  it('skips age prune when retentionDays <= 0', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const now = 1_700_000_000;
    for (let i = 0; i < 5; i++) seedAudit(now - 10_000 * 86_400); // ancient

    const result = pruneMod.runAuditPruneNow({
      retentionDays: 0,
      maxRows: 100,
      nowSec: now,
    });

    expect(result.removed_by_age).toBe(0);
    expect(result.remaining).toBe(5);
  });

  it('skips overflow trim when maxRows <= 0', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const now = 1_700_000_000;
    for (let i = 0; i < 10; i++) seedAudit(now - i);

    const result = pruneMod.runAuditPruneNow({
      retentionDays: 365,
      maxRows: 0,
      nowSec: now,
    });

    expect(result.removed_by_overflow).toBe(0);
    expect(result.remaining).toBe(10);
  });

  it('reads retention from env when no override is passed', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.AUDIT_LOG_RETENTION_DAYS = '30';
    const now = 1_700_000_000;
    const day = 86_400;
    seedAudit(now - 40 * day); // beyond 30 days
    seedAudit(now - 5 * day); //  within 30 days

    const result = pruneMod.runAuditPruneNow({ nowSec: now });
    expect(result.removed_by_age).toBe(1);
    expect(result.retention_days).toBe(30);
    expect(result.remaining).toBe(1);
  });

  it('emits a single JSON status line to stdout', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const now = 1_700_000_000;
    seedAudit(now);
    pruneMod.runAuditPruneNow({ retentionDays: 365, maxRows: 100, nowSec: now });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      type: 'audit_prune',
      ts: now,
      removed_by_age: 0,
      removed_by_overflow: 0,
      remaining: 1,
      retention_days: 365,
      max_rows: 100,
    });
  });

  it('is a no-op on an empty table', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = pruneMod.runAuditPruneNow({
      retentionDays: 365,
      maxRows: 100,
      nowSec: 1_700_000_000,
    });
    expect(result).toMatchObject({
      removed_by_age: 0,
      removed_by_overflow: 0,
      remaining: 0,
    });
  });
});
