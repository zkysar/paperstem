import { describe, expect, test } from 'vitest';
import { fmt, clamp, formatDurationMs, formatRelativeDate, pixelToTime, longestStemIdx, formatRelativeTime } from './format';

describe('fmt', () => {
  test('formats seconds as M:SS', () => {
    expect(fmt(0)).toBe('0:00');
    expect(fmt(5)).toBe('0:05');
    expect(fmt(65)).toBe('1:05');
    expect(fmt(3599)).toBe('59:59');
  });

  test('clamps invalid values', () => {
    expect(fmt(NaN)).toBe('0:00');
    expect(fmt(-1)).toBe('0:00');
    expect(fmt(Infinity)).toBe('0:00');
  });
});

describe('clamp', () => {
  test('respects bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('pixelToTime', () => {
  test('maps pixels to seconds and clamps', () => {
    expect(pixelToTime(0, 100, 60)).toBe(0);
    expect(pixelToTime(50, 100, 60)).toBe(30);
    expect(pixelToTime(100, 100, 60)).toBe(60);
    expect(pixelToTime(150, 100, 60)).toBe(60);
    expect(pixelToTime(-10, 100, 60)).toBe(0);
  });

  test('returns 0 for zero width or duration', () => {
    expect(pixelToTime(50, 0, 60)).toBe(0);
    expect(pixelToTime(50, 100, 0)).toBe(0);
  });
});

describe('formatDurationMs', () => {
  test('formats sub-hour durations as M:SS', () => {
    expect(formatDurationMs(0)).toBe('0:00');
    expect(formatDurationMs(45_000)).toBe('0:45');
    expect(formatDurationMs(90_000)).toBe('1:30');
    expect(formatDurationMs(272_000)).toBe('4:32');
  });

  test('formats >= 1h as H:MM:SS', () => {
    expect(formatDurationMs(3_600_000)).toBe('1:00:00');
    expect(formatDurationMs(3_690_000)).toBe('1:01:30');
  });

  test('returns empty string for invalid inputs', () => {
    expect(formatDurationMs(null)).toBe('');
    expect(formatDurationMs(NaN)).toBe('');
    expect(formatDurationMs(-1)).toBe('');
    expect(formatDurationMs(Infinity)).toBe('');
  });
});

describe('formatRelativeDate', () => {
  // Pin "now" so the relative buckets are deterministic across CI machines.
  const now = new Date('2026-05-14T12:00:00Z').getTime();

  test('Today / Yesterday for recent timestamps', () => {
    expect(formatRelativeDate(new Date('2026-05-14T08:00:00Z').getTime(), now)).toBe('Today');
    expect(formatRelativeDate(new Date('2026-05-13T22:00:00Z').getTime(), now)).toBe('Yesterday');
  });

  test('within current year: short day+month', () => {
    const out = formatRelativeDate(new Date('2026-03-14T12:00:00Z').getTime(), now);
    // Locale-dependent formatting; just assert the year is omitted and Mar appears.
    expect(out).toMatch(/Mar/);
    expect(out).not.toMatch(/2026/);
  });

  test('prior years include the year', () => {
    const out = formatRelativeDate(new Date('2024-08-02T12:00:00Z').getTime(), now);
    expect(out).toMatch(/2024/);
  });

  test('empty string when timestamp is missing or invalid', () => {
    expect(formatRelativeDate(0, now)).toBe('');
    expect(formatRelativeDate(NaN, now)).toBe('');
    expect(formatRelativeDate(Infinity, now)).toBe('');
  });
});

describe('longestStemIdx', () => {
  test('picks the longest finite duration', () => {
    expect(longestStemIdx([10, 30, 20])).toBe(1);
    expect(longestStemIdx([5])).toBe(0);
  });

  test('ignores non-finite durations', () => {
    expect(longestStemIdx([NaN, 7, Infinity])).toBe(1);
    expect(longestStemIdx([NaN, NaN])).toBe(0);
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-05-18T12:00:00Z').getTime();

  test('returns "just now" within 60 seconds', () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe('just now');
    expect(formatRelativeTime(now, now)).toBe('just now');
  });

  test('returns minutes for the first hour', () => {
    expect(formatRelativeTime(now - 5 * 60 * 1000, now)).toBe('5m ago');
    expect(formatRelativeTime(now - 59 * 60 * 1000, now)).toBe('59m ago');
  });

  test('returns hours up to 24h', () => {
    expect(formatRelativeTime(now - 2 * 60 * 60 * 1000, now)).toBe('2h ago');
    expect(formatRelativeTime(now - 23 * 60 * 60 * 1000, now)).toBe('23h ago');
  });

  test('returns days up to 7d', () => {
    expect(formatRelativeTime(now - 2 * 24 * 60 * 60 * 1000, now)).toBe('2d ago');
    expect(formatRelativeTime(now - 6 * 24 * 60 * 60 * 1000, now)).toBe('6d ago');
  });

  test('falls back to absolute date past a week', () => {
    const old = new Date('2026-03-14T12:00:00Z').getTime();
    expect(formatRelativeTime(old, now)).toBe('14 Mar');
  });

  test('includes year when older than the current year', () => {
    const old = new Date('2024-08-02T12:00:00Z').getTime();
    expect(formatRelativeTime(old, now)).toBe('2 Aug 2024');
  });

  test('returns empty string for invalid timestamps', () => {
    expect(formatRelativeTime(0, now)).toBe('');
    expect(formatRelativeTime(NaN, now)).toBe('');
    expect(formatRelativeTime(Infinity, now)).toBe('');
  });
});
