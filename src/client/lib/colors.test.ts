import { describe, expect, test } from 'vitest';
import { mix } from './colors';

describe('mix', () => {
  test('returns input colors at endpoints', () => {
    expect(mix('#ff0000', '#000000', 0)).toBe('#ff0000');
    expect(mix('#ff0000', '#000000', 1)).toBe('#000000');
  });

  test('averages channels at midpoint', () => {
    expect(mix('#ffffff', '#000000', 0.5)).toBe('#808080');
  });

  test('pads short hex output to six digits', () => {
    expect(mix('#000001', '#000003', 0.5)).toBe('#000002');
  });
});
