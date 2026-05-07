import { describe, expect, test } from 'vitest';
import {
  ANNOTATION_PALETTE,
  SELF_ANNOTATION_COLOR,
  buildUserColorMap,
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

describe('buildUserColorMap', () => {
  test('self maps to SELF color', () => {
    const m = buildUserColorMap(['me', 'a'], 'me');
    expect(m.get('me')).toBe(SELF_ANNOTATION_COLOR);
  });

  test('distinct non-self users get distinct palette colors up to palette size', () => {
    const ids = ['u-a', 'u-b', 'u-c', 'u-d', 'u-e', 'u-f'];
    const m = buildUserColorMap(ids, 'me');
    const colors = ids.map((id) => m.get(id));
    expect(new Set(colors).size).toBe(Math.min(ids.length, ANNOTATION_PALETTE.length));
  });

  test('order is stable across iteration order changes', () => {
    const a = buildUserColorMap(['c', 'a', 'b'], 'me');
    const b = buildUserColorMap(['b', 'c', 'a'], 'me');
    expect(a.get('a')).toBe(b.get('a'));
    expect(a.get('b')).toBe(b.get('b'));
    expect(a.get('c')).toBe(b.get('c'));
  });

  test('handles real Paper Straw user_ids without collision', () => {
    const m = buildUserColorMap(
      [
        '299ac971-45be-4cf2-b309-dfd32fbab2da',
        '82e490ff-790f-443f-b3a1-ea87e7eb166f',
        'df86cea3-17f5-45b0-826e-0a8f5527b196',
        '644dc61c-946d-48e1-b2bb-d344c2fb1d97',
        '4518df3f-ae9c-41aa-922f-e2e8272384f7',
        'ee6ecda7-15e0-4c21-a818-e06311e743f0',
      ],
      '299ac971-45be-4cf2-b309-dfd32fbab2da',
    );
    const non_self = [
      m.get('82e490ff-790f-443f-b3a1-ea87e7eb166f'),
      m.get('df86cea3-17f5-45b0-826e-0a8f5527b196'),
      m.get('644dc61c-946d-48e1-b2bb-d344c2fb1d97'),
      m.get('4518df3f-ae9c-41aa-922f-e2e8272384f7'),
      m.get('ee6ecda7-15e0-4c21-a818-e06311e743f0'),
    ];
    expect(new Set(non_self).size).toBe(5);
  });
});
