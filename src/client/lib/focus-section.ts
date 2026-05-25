import type { Section } from '../../shared/types';

// The section a project should land on when it's opened while the picker's
// song filter is active: the earliest section that references that song.
// A song can be tagged at several points in a take (e.g. two run-throughs);
// the first occurrence is the natural place to drop the listener. Returns
// null when no section references the song (stale usage data, or the song
// was untagged after the filter was applied).
export function pickSongFocusSection(
  sections: readonly Section[],
  songId: string,
): Section | null {
  let best: Section | null = null;
  for (const s of sections) {
    if (s.song_id !== songId) continue;
    if (!best || s.start_ms < best.start_ms) best = s;
  }
  return best;
}
