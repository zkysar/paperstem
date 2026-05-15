import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// scheduler.ts pulls in disk-usage.ts → mailer.ts, which throws at import
// time if GMAIL_* are unset. It also now pulls in notifications-flush.ts →
// db.ts, which requires DATABASE_PATH. Set all env vars before any dynamic import.
process.env.GMAIL_USER ||= 'test@example.com';
process.env.GMAIL_APP_PASSWORD ||= 'test-pass';
process.env.DATABASE_PATH ||= join(mkdtempSync(join(tmpdir(), 'paperstem-scheduler-test-')), 'test.sqlite');

type SchedulerModule = typeof import('./scheduler.js');
type FlushModule = typeof import('./notifications-flush.js');

const schedulerMod = await import('./scheduler.js') as SchedulerModule;
const flushMod = await import('./notifications-flush.js') as FlushModule;
const { msUntilNextDailyUtc, msUntilNextWeeklyUtc } = schedulerMod;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

describe('msUntilNextDailyUtc', () => {
  it('returns time until later same day when before target hour', () => {
    const now = Date.UTC(2026, 4, 7, 1, 0, 0);
    const ms = msUntilNextDailyUtc(now, 3);
    expect(ms).toBe(2 * HOUR_MS);
  });

  it('returns time until next day when after target hour', () => {
    const now = Date.UTC(2026, 4, 7, 5, 0, 0);
    const ms = msUntilNextDailyUtc(now, 3);
    expect(ms).toBe(22 * HOUR_MS);
  });

  it('rolls forward exactly one day when called at the target hour', () => {
    const now = Date.UTC(2026, 4, 7, 3, 0, 0);
    const ms = msUntilNextDailyUtc(now, 3);
    expect(ms).toBe(DAY_MS);
  });

  it('handles month boundary', () => {
    const now = Date.UTC(2026, 4, 31, 23, 30, 0);
    const ms = msUntilNextDailyUtc(now, 3);
    expect(ms).toBe(3.5 * HOUR_MS);
    const target = new Date(now + ms);
    expect(target.getUTCMonth()).toBe(5);
    expect(target.getUTCDate()).toBe(1);
    expect(target.getUTCHours()).toBe(3);
  });
});

describe('msUntilNextWeeklyUtc', () => {
  it('returns time until target hour later today when target day matches and before hour', () => {
    const now = Date.UTC(2026, 4, 3, 1, 0, 0);
    const ms = msUntilNextWeeklyUtc(now, 0, 4);
    expect(ms).toBe(3 * HOUR_MS);
  });

  it('rolls a full week when called at the target moment', () => {
    const now = Date.UTC(2026, 4, 3, 4, 0, 0);
    const ms = msUntilNextWeeklyUtc(now, 0, 4);
    expect(ms).toBe(WEEK_MS);
  });

  it('jumps to the right day-of-week when current dow is later in the week', () => {
    const now = Date.UTC(2026, 4, 5, 12, 0, 0);
    const ms = msUntilNextWeeklyUtc(now, 0, 4);
    const target = new Date(now + ms);
    expect(target.getUTCDay()).toBe(0);
    expect(target.getUTCHours()).toBe(4);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(WEEK_MS);
  });

  it('rolls to next week when same dow but after target hour', () => {
    const now = Date.UTC(2026, 4, 3, 6, 0, 0);
    const ms = msUntilNextWeeklyUtc(now, 0, 4);
    const target = new Date(now + ms);
    expect(target.getUTCDay()).toBe(0);
    expect(target.getUTCHours()).toBe(4);
    expect(ms).toBeGreaterThan(6 * DAY_MS);
    expect(ms).toBeLessThan(WEEK_MS);
  });
});

describe('startScheduler flush jobs', () => {
  afterEach(() => {
    schedulerMod.stopScheduler();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('triggers batched and daily flush after FIRST_RUN_DELAY_MS (30s)', async () => {
    vi.useFakeTimers();
    const batchedSpy = vi.spyOn(flushMod, 'runBatchedFlushNow').mockResolvedValue(undefined);
    const dailySpy = vi.spyOn(flushMod, 'runDailyFlushNow').mockResolvedValue(undefined);
    schedulerMod.startScheduler();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(batchedSpy).toHaveBeenCalledTimes(1);
    expect(dailySpy).toHaveBeenCalledTimes(1);
  });
});
