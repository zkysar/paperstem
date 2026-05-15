import { describe, it, expect } from 'vitest';
import {
  proposeSectionName,
  shouldEmitSection,
  CONFIDENCE_HIGH,
  CONFIDENCE_LOW,
} from './naming.js';

describe('proposeSectionName', () => {
  it('returns the matched song name when confidence is high', () => {
    const out = proposeSectionName({
      segment_type: 'music',
      match: { song_id: 'sng_1', song_name: 'Wagon Wheel' },
      confidence: CONFIDENCE_HIGH + 0.01,
    });
    expect(out).toEqual({
      song_id: 'sng_1',
      song_name: 'Wagon Wheel',
      label: null,
      tentative: false,
    });
  });

  it('returns the matched song name with tentative flag when low', () => {
    const out = proposeSectionName({
      segment_type: 'music',
      match: { song_id: 'sng_1', song_name: 'Wagon Wheel' },
      confidence: CONFIDENCE_LOW + 0.01,
    });
    expect(out).toEqual({
      song_id: 'sng_1',
      song_name: 'Wagon Wheel',
      label: null,
      tentative: true,
    });
  });

  it('returns "Music" label when music segment has no match', () => {
    const out = proposeSectionName({
      segment_type: 'music',
      match: null,
      confidence: 0,
    });
    expect(out).toEqual({ song_id: null, song_name: null, label: 'Music', tentative: false });
  });

  it('returns "Music" label when match is present but confidence is below low threshold', () => {
    const out = proposeSectionName({
      segment_type: 'music',
      match: { song_id: 'sng_1', song_name: 'Wagon Wheel' },
      confidence: CONFIDENCE_LOW - 0.01,
    });
    expect(out).toEqual({ song_id: null, song_name: null, label: 'Music', tentative: false });
  });

  it('returns "Chatter" label for chatter segment', () => {
    const out = proposeSectionName({ segment_type: 'chatter', match: null, confidence: 0 });
    expect(out).toEqual({ song_id: null, song_name: null, label: 'Chatter', tentative: false });
  });

  it('returns "Tuning" label for tuning segment', () => {
    const out = proposeSectionName({ segment_type: 'tuning', match: null, confidence: 0 });
    expect(out).toEqual({ song_id: null, song_name: null, label: 'Tuning', tentative: false });
  });

  it('returns "Count-in" for count_in segment', () => {
    const out = proposeSectionName({ segment_type: 'count_in', match: null, confidence: 0 });
    expect(out.label).toBe('Count-in');
  });
});

describe('shouldEmitSection', () => {
  it('omits silence segments', () => {
    expect(shouldEmitSection('silence')).toBe(false);
  });
  it('omits unknown segments', () => {
    expect(shouldEmitSection('unknown')).toBe(false);
  });
  it('emits music, chatter, tuning, count_in', () => {
    expect(shouldEmitSection('music')).toBe(true);
    expect(shouldEmitSection('chatter')).toBe(true);
    expect(shouldEmitSection('tuning')).toBe(true);
    expect(shouldEmitSection('count_in')).toBe(true);
  });
});
