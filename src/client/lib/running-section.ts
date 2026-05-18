import type { Section } from '../../shared/types';
import { END_SECTION_LABEL } from './section-end';

// The section whose span on the timeline contains clickStartMs, or null if
// none. "Span" means: from this section's start_ms up to (but not including)
// the next section's start_ms — or up to the track end if there is none.
// An em-dash terminator section is not itself a running section: its only
// job is to end whatever came before, so callers should treat it as null.
export function findRunningSection(
  sections: readonly Section[],
  clickStartMs: number,
): Section | null {
  if (sections.length === 0) return null;
  const sorted = [...sections].sort((a, b) => a.start_ms - b.start_ms);
  let candidate: Section | null = null;
  for (const s of sorted) {
    if (s.start_ms < clickStartMs) candidate = s;
    else break;
  }
  if (!candidate) return null;
  if (candidate.label === END_SECTION_LABEL) return null;
  return candidate;
}
