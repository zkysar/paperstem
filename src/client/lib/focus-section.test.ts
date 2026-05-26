import { describe, it, expect } from 'vitest';
import type { Section } from '../../shared/types';
import { pickSongFocusSection } from './focus-section';

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

describe('pickSongFocusSection', () => {
  it('returns null when there are no sections', () => {
    expect(pickSongFocusSection([], 'song-1')).toBeNull();
  });

  it('returns null when no section references the song', () => {
    const sections = [
      s({ id: 'a', start_ms: 0, song_id: 'song-2' }),
      s({ id: 'b', start_ms: 5_000, label: 'warmup' }),
    ];
    expect(pickSongFocusSection(sections, 'song-1')).toBeNull();
  });

  it('returns the only matching section', () => {
    const sections = [
      s({ id: 'a', start_ms: 0, song_id: 'song-2' }),
      s({ id: 'b', start_ms: 5_000, song_id: 'song-1' }),
    ];
    expect(pickSongFocusSection(sections, 'song-1')?.id).toBe('b');
  });

  it('returns the earliest section when the song is tagged more than once', () => {
    const sections = [
      s({ id: 'late', start_ms: 90_000, song_id: 'song-1' }),
      s({ id: 'early', start_ms: 12_000, song_id: 'song-1' }),
      s({ id: 'other', start_ms: 0, song_id: 'song-2' }),
    ];
    expect(pickSongFocusSection(sections, 'song-1')?.id).toBe('early');
  });

  it('does not require sections to be passed in sorted order', () => {
    const sections = [
      s({ id: 'b', start_ms: 30_000, song_id: 'song-1' }),
      s({ id: 'a', start_ms: 0, song_id: 'song-1' }),
    ];
    expect(pickSongFocusSection(sections, 'song-1')?.id).toBe('a');
  });
});
