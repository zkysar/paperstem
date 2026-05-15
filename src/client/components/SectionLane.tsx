import { useMemo } from 'react';
import { Link2 } from 'lucide-react';
import type { Section } from '../../shared/types';
import { FREE_TEXT_SECTION_COLOR, colorForSong } from '../lib/colors';

type Props = {
  sections: Section[];
  duration: number;
  waveLeftPx: number;
  waveWidthPx: number;
  // How many distinct projects each song appears in (across the band).
  // Sections whose song appears in >1 project get a chain glyph signaling
  // "this name is shared." Free-text and unnamed sections never get one.
  songUseCounts: Map<string, number>;
  activeSectionId: string | null;
  onSelect(section: Section): void;
  onSeek(timeSeconds: number): void;
};

type ComputedSection = {
  section: Section;
  leftPx: number;
  widthPx: number;
  fillColor: string;
  label: string;
  shared: boolean;
};

function labelFor(section: Section): string {
  if (section.song_name) return section.song_name;
  if (section.label) return section.label;
  return 'Untitled';
}

export function SectionLane({
  sections,
  duration,
  waveLeftPx,
  waveWidthPx,
  songUseCounts,
  activeSectionId,
  onSelect,
  onSeek,
}: Props) {
  const computed = useMemo<ComputedSection[]>(() => {
    if (!duration || !waveWidthPx || sections.length === 0) return [];
    const durationMs = duration * 1000;
    const sorted = [...sections].sort((a, b) => a.start_ms - b.start_ms);
    const laneRightPx = waveLeftPx + waveWidthPx;
    return sorted.map((section, i) => {
      const next = sorted[i + 1];
      const endMs = next ? next.start_ms : durationMs;
      const startFrac = Math.max(0, Math.min(1, section.start_ms / durationMs));
      const endFrac = Math.max(0, Math.min(1, endMs / durationMs));
      let leftPx = waveLeftPx + startFrac * waveWidthPx;
      // Floor at 4px so a section right before another (or right at the
      // end of the song) stays clickable.
      const widthPx = Math.max(4, (endFrac - startFrac) * waveWidthPx);
      // If the pill would extend past the lane's right edge — e.g. a
      // section dropped at t=duration with the floor applied — pull
      // leftPx back so the full 4px sits on-screen.
      if (leftPx + widthPx > laneRightPx) {
        leftPx = Math.max(waveLeftPx, laneRightPx - widthPx);
      }
      const fillColor = section.song_id
        ? colorForSong(section.song_id)
        : FREE_TEXT_SECTION_COLOR;
      const shared = !!section.song_id
        && (songUseCounts.get(section.song_id) ?? 0) > 1;
      return {
        section,
        leftPx,
        widthPx,
        fillColor,
        label: labelFor(section),
        shared,
      };
    });
  }, [sections, duration, waveLeftPx, waveWidthPx, songUseCounts]);

  if (computed.length === 0) return null;

  return (
    <div className="section-lane" aria-label="Song sections">
      {computed.map((c) => {
        const isActive = activeSectionId === c.section.id;
        return (
          <button
            type="button"
            key={c.section.id}
            data-testid={`section-${c.section.id}`}
            data-section-id={c.section.id}
            className={'section-pill' + (isActive ? ' active' : '')}
            style={{
              left: `${c.leftPx}px`,
              width: `${c.widthPx}px`,
              backgroundColor: c.fillColor,
            }}
            title={
              c.section.song_name
                ? c.shared
                  ? `${c.section.song_name} · used in ${songUseCounts.get(c.section.song_id ?? '') ?? 1} practices`
                  : c.section.song_name
                : c.section.label ?? 'Untitled boundary'
            }
            onClick={(e) => {
              // Shift+click selects without seeking — useful when you want
              // to rename without losing your listening position.
              if (!e.shiftKey) onSeek(c.section.start_ms / 1000);
              onSelect(c.section);
            }}
          >
            <span className="section-pill-label">{c.label}</span>
            {c.shared && (
              <Link2
                size={10}
                strokeWidth={2.5}
                aria-hidden="true"
                className="section-pill-chain"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
