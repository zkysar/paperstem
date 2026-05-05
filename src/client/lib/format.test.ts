import { describe, expect, test } from 'vitest';
import { fmt, clamp, pixelToTime, longestStemIdx } from './format';

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
