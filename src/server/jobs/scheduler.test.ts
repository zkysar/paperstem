import { describe, expect, it } from 'vitest';
import {
  msUntilNextDailyUtc,
  msUntilNextWeeklyUtc,
} from './scheduler.js';

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
