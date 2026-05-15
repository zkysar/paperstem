import { describe, expect, test } from 'vitest';
import { smoothAndSegment } from './smooth';
import type { SegmentType, TopClass } from '../../../shared/types';

const WINDOW_MS = 480;

function tops(c: SegmentType): TopClass[] {
  switch (c) {
    case 'music':
      return [{ name: 'Music', score: 0.9 }];
    case 'chatter':
      return [{ name: 'Speech', score: 0.9 }];
    case 'silence':
      return [{ name: 'Silence', score: 0.95 }];
    case 'tuning':
      return [{ name: 'Tuning fork', score: 0.5 }];
    case 'count_in':
      return [{ name: 'Drum', score: 0.8 }];
    case 'unknown':
      return [{ name: 'Mosquito', score: 0.05 }];
  }
}

describe('smoothAndSegment', () => {
  test('merges contiguous same-class windows', () => {
    const classes: SegmentType[] = ['music', 'music', 'music', 'music'];
    const top = classes.map(tops);
    const segments = smoothAndSegment(classes, top, WINDOW_MS, {
      minSegmentMs: 0,
    });
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      start_ms: 0,
      end_ms: 4 * WINDOW_MS,
      segment_type: 'music',
    });
  });

  test('filters single-window noise via median smoothing', () => {
    const classes: SegmentType[] = [
      'music',
      'music',
      'chatter',
      'music',
      'music',
    ];
    const top = classes.map(tops);
    const segments = smoothAndSegment(classes, top, WINDOW_MS, {
      minSegmentMs: 0,
    });
    expect(segments).toHaveLength(1);
    expect(segments[0].segment_type).toBe('music');
  });

  test('drops segments shorter than minSegmentMs', () => {
    const classes: SegmentType[] = [
      'music',
      'music',
      'music',
      'music',
      'music',
      'music',
      'chatter',
      'chatter',
      'music',
      'music',
      'music',
      'music',
      'music',
      'music',
    ];
    const top = classes.map(tops);
    const segments = smoothAndSegment(classes, top, WINDOW_MS, {
      minSegmentMs: 4000,
      medianRadius: 0, // disable median smoothing so the test purely exercises
      // the "absorb short segments" stage
    });
    // The chatter run is 2 * 480ms = 960ms, below 4000ms threshold; it gets
    // absorbed into the surrounding music.
    expect(segments).toHaveLength(1);
    expect(segments[0].segment_type).toBe('music');
  });

  test('preserves transitions when both sides exceed the threshold', () => {
    const classes: SegmentType[] = (
      Array(20).fill('music') as SegmentType[]
    ).concat(Array(20).fill('chatter') as SegmentType[]);
    const top = classes.map(tops);
    const segments = smoothAndSegment(classes, top, WINDOW_MS, {
      minSegmentMs: 1000,
    });
    expect(segments).toHaveLength(2);
    expect(segments[0].segment_type).toBe('music');
    expect(segments[1].segment_type).toBe('chatter');
  });

  test('aggregates top_classes across the segment', () => {
    const classes: SegmentType[] = ['music', 'music', 'music'];
    const top: TopClass[][] = [
      [
        { name: 'Music', score: 0.9 },
        { name: 'Guitar', score: 0.4 },
      ],
      [
        { name: 'Music', score: 0.8 },
        { name: 'Singing', score: 0.5 },
      ],
      [
        { name: 'Music', score: 0.7 },
        { name: 'Guitar', score: 0.3 },
      ],
    ];
    const segments = smoothAndSegment(classes, top, WINDOW_MS, {
      minSegmentMs: 0,
    });
    expect(segments).toHaveLength(1);
    const names = segments[0].top_classes.map((tc) => tc.name);
    expect(names[0]).toBe('Music'); // average 0.8 — highest
    expect(names).toContain('Guitar');
    expect(names).toContain('Singing');
  });

  test('returns empty for empty input', () => {
    expect(smoothAndSegment([], [], WINDOW_MS)).toEqual([]);
  });

  test('throws on classes/topPerWindow length mismatch', () => {
    expect(() =>
      smoothAndSegment(['music'], [], WINDOW_MS),
    ).toThrow(/length mismatch/);
  });
});
