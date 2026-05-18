import type { Section } from '../../shared/types';
import { END_SECTION_LABEL } from './section-end';

// The section whose span on the timeline contains clickStartMs, or null if
// none. "Span" means: from this section's start_ms up to (but not including)
// the next section's start_ms — or up to the track end if there is none.
// An em-dash terminator section is not itself a running section: its only
// job is to end whatever came before, so callers should treat it as null.
// A section with neither a song name nor a free-text label has no identity
// to render in an "End ... here" action, so it is also treated as null.
export function findRunningSection(
  sections: readonly Section[],
  clickStartMs: number,
): Section | null {
  if (sections.length === 0) return null;
  // Sorted: the first item with start_ms >= clickStartMs ends the search,
  // because every subsequent item has an even larger start_ms.
  const sorted = [...sections].sort((a, b) => a.start_ms - b.start_ms);
  let candidate: Section | null = null;
  for (const s of sorted) {
    if (s.start_ms < clickStartMs) candidate = s;
    else break;
  }
  if (!candidate) return null;
  if (candidate.label === END_SECTION_LABEL) return null;
  if (!candidate.song_name && !candidate.label) return null;
  return candidate;
}
