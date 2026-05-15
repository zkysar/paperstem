import { useMemo } from 'react';
import { Link2 } from 'lucide-react';
import type { Section } from '../../shared/types';

type Props = {
  sections: Section[];
  songUseCounts: Map<string, number>;
  currentTimeSeconds: number;
  onSeek(timeSeconds: number): void;
};

function labelFor(section: Section): string {
  if (section.song_name) return section.song_name;
  if (section.label) return section.label;
  return 'Untitled';
}

export function ActiveSectionChip({
  sections,
  songUseCounts,
  currentTimeSeconds,
  onSeek,
}: Props) {
  const active = useMemo<Section | null>(() => {
    if (sections.length === 0) return null;
    const currentMs = currentTimeSeconds * 1000;
    const sorted = [...sections].sort((a, b) => a.start_ms - b.start_ms);
    let containing: Section | null = null;
    for (const s of sorted) {
      if (s.start_ms <= currentMs) containing = s;
      else break;
    }
    return containing;
  }, [sections, currentTimeSeconds]);

  if (!active) return null;

  const shared = !!active.song_id
    && (songUseCounts.get(active.song_id) ?? 0) > 1;

  return (
    <button
      type="button"
      className="active-section-chip"
      onClick={() => onSeek(active.start_ms / 1000)}
      title={`Jump to ${labelFor(active)}`}
    >
      <span className="active-section-chip-label">{labelFor(active)}</span>
      {shared && (
        <Link2
          size={10}
          strokeWidth={2.5}
          aria-hidden="true"
          className="active-section-chip-chain"
        />
      )}
    </button>
  );
}
