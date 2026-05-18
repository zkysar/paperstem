import { describe, it, expect } from 'vitest';
import type { Section } from '../../shared/types';
import { findRunningSection } from './running-section';

function s(over: Partial<Section> & { id: string; start_ms: number }): Section {
  return {
    id: over.id,
    project_id: 'p-1',
    start_ms: over.start_ms,
    song_id: over.song_id ?? null,
    song_name: over.song_name ?? null,
    label: over.label ?? null,
    source: over.source ?? 'manual',
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

describe('findRunningSection', () => {
  it('returns null when there are no sections', () => {
    expect(findRunningSection([], 5000)).toBeNull();
  });

  it('returns null when the click is before the first section', () => {
    const sections = [s({ id: 'a', start_ms: 10_000, song_name: 'A' })];
    expect(findRunningSection(sections, 5_000)).toBeNull();
  });

  it('returns the most recent section whose span contains the click', () => {
    const sections = [
      s({ id: 'a', start_ms: 0, song_name: 'A' }),
      s({ id: 'b', start_ms: 30_000, song_name: 'B' }),
    ];
    expect(findRunningSection(sections, 10_000)?.id).toBe('a');
    expect(findRunningSection(sections, 40_000)?.id).toBe('b');
  });

  it('returns null when the running section is an em-dash terminator', () => {
    const sections = [
      s({ id: 'a', start_ms: 0, song_name: 'A' }),
      s({ id: 'end', start_ms: 10_000, label: '—' }),
    ];
    expect(findRunningSection(sections, 15_000)).toBeNull();
  });

  it('does not require sections to be passed in sorted order', () => {
    const sections = [
      s({ id: 'b', start_ms: 30_000, song_name: 'B' }),
      s({ id: 'a', start_ms: 0, song_name: 'A' }),
    ];
    expect(findRunningSection(sections, 10_000)?.id).toBe('a');
  });

  it('treats start_ms == clickStartMs as the click being inside the previous span', () => {
    const sections = [
      s({ id: 'a', start_ms: 0, song_name: 'A' }),
      s({ id: 'b', start_ms: 30_000, song_name: 'B' }),
    ];
    // Click exactly at b's start: b has not "started running" yet by the
    // strict-less-than rule, so a is still the running section.
    expect(findRunningSection(sections, 30_000)?.id).toBe('a');
  });
});
