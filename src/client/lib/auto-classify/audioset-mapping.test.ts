import { describe, expect, test } from 'vitest';
import { mapTopClassesToSegmentType } from './audioset-mapping';

describe('mapTopClassesToSegmentType', () => {
  test('returns music for top class = "Music"', () => {
    expect(mapTopClassesToSegmentType([{ name: 'Music', score: 0.9 }])).toBe(
      'music',
    );
  });

  test('returns music for guitar/drum AudioSet names', () => {
    expect(
      mapTopClassesToSegmentType([{ name: 'Electric guitar', score: 0.6 }]),
    ).toBe('music');
    expect(mapTopClassesToSegmentType([{ name: 'Drum kit', score: 0.4 }])).toBe(
      'music',
    );
  });

  test('returns chatter for "Speech" dominant', () => {
    expect(
      mapTopClassesToSegmentType([
        { name: 'Speech', score: 0.7 },
        { name: 'Music', score: 0.1 },
      ]),
    ).toBe('chatter');
  });

  test('returns chatter for conversation/whispering/monologue', () => {
    expect(
      mapTopClassesToSegmentType([{ name: 'Conversation', score: 0.5 }]),
    ).toBe('chatter');
    expect(
      mapTopClassesToSegmentType([{ name: 'Whispering', score: 0.2 }]),
    ).toBe('chatter');
    expect(
      mapTopClassesToSegmentType([
        { name: 'Narration, monologue', score: 0.3 },
      ]),
    ).toBe('chatter');
  });

  test('returns tuning for "Tuning fork"', () => {
    expect(
      mapTopClassesToSegmentType([{ name: 'Tuning fork', score: 0.5 }]),
    ).toBe('tuning');
  });

  test('returns silence for "Silence" dominant', () => {
    expect(
      mapTopClassesToSegmentType([{ name: 'Silence', score: 0.95 }]),
    ).toBe('silence');
  });

  test('returns unknown when nothing matches', () => {
    expect(mapTopClassesToSegmentType([{ name: 'Mosquito', score: 0.4 }])).toBe(
      'unknown',
    );
  });

  test('returns unknown when top score is below threshold', () => {
    expect(mapTopClassesToSegmentType([{ name: 'Music', score: 0.05 }])).toBe(
      'unknown',
    );
  });

  test('returns unknown for empty input', () => {
    expect(mapTopClassesToSegmentType([])).toBe('unknown');
  });
});
