import { describe, expect, test } from 'vitest';
import {
  ANNOTATION_PALETTE,
  SELF_ANNOTATION_COLOR,
  colorForAnnotationAuthor,
  mix,
  paletteIndexForUserId,
} from './colors';

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

describe('paletteIndexForUserId', () => {
  test('returns the same index for the same user id', () => {
    const id = 'user-abc-123';
    const a = paletteIndexForUserId(id, ANNOTATION_PALETTE.length);
    const b = paletteIndexForUserId(id, ANNOTATION_PALETTE.length);
    expect(a).toBe(b);
  });

  test('always returns an index in range', () => {
    const ids = [
      '',
      'a',
      'short',
      'longer-user-id-with-dashes-and-uuids',
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    ];
    for (const id of ids) {
      const idx = paletteIndexForUserId(id, ANNOTATION_PALETTE.length);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(ANNOTATION_PALETTE.length);
    }
  });
});

describe('colorForAnnotationAuthor', () => {
  test('returns SELF color when user_id matches selfUserId', () => {
    const c = colorForAnnotationAuthor('me', 'me');
    expect(c).toBe(SELF_ANNOTATION_COLOR);
  });

  test('returns a stable palette color for non-self users', () => {
    const a = colorForAnnotationAuthor('other-user', 'me');
    const b = colorForAnnotationAuthor('other-user', 'me');
    expect(a).toBe(b);
    expect(ANNOTATION_PALETTE).toContain(a);
  });

  test('different non-self users may get different colors', () => {
    const colors = new Set<string>();
    for (let i = 0; i < 50; i++) {
      colors.add(colorForAnnotationAuthor(`u-${i}`, 'me'));
    }
    expect(colors.size).toBeGreaterThan(1);
  });
});
