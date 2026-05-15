import { useMemo } from 'react';
import { Link2 } from 'lucide-react';
import type { Section } from '../../shared/types';
import { FREE_TEXT_SECTION_COLOR, colorForSong } from '../lib/colors';

type Props = {
  sections: Section[];
  duration: number;
  waveLeftPx: number;
  waveWidthPx: number;
  songUseCounts: Map<string, number>;
  activeSectionId: string | null;
  expanded: boolean;
  interactionDisabled: boolean;
  onSelect(section: Section): void;
  onSeek(timeSeconds: number): void;
  onHoverChange(hovered: boolean): void;
  onTapToExpand(): void;
  onPatchSection?(id: string, input: { start_ms: number }): Promise<void>;
};

type ComputedSection = {
  section: Section;
  leftPx: number;
  widthPx: number;
  fillColor: string;
  label: string;
  shared: boolean;
};

const NARROW_SEGMENT_PX = 8;

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
  expanded,
  interactionDisabled,
  onSelect,
  onSeek,
  onHoverChange,
  onTapToExpand,
  onPatchSection,
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

  const wrapClassName =
    'section-lane-wrap' +
    (expanded ? ' expanded' : ' collapsed') +
    (interactionDisabled ? ' disabled' : '');

  return (
    <div
      className={wrapClassName}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onPointerDown={() => {
        if (!expanded) onTapToExpand();
      }}
    >
      {/* Sticky mask over the rail column — when the viewport is zoomed
          and scrolled horizontally, segments positioned in the wave
          column (viewport-inner x >= railWidth) move left in screen space
          and would otherwise bleed over the track-name / M / S / delete
          column below. Mirrors .ruler-rail-mask in the ruler band. Lives
          here so both ribbon and pills modes get the same coverage. */}
      <div className="section-rail-mask" aria-hidden="true" />
      {expanded ? (
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
                  // Shift+click selects without seeking — useful when you
                  // want to rename without losing your listening position.
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
      ) : (
        <div className="section-ribbon" aria-label="Song sections (collapsed)">
          {computed.map((c, i) => {
            const isLast = i === computed.length - 1;
            const isNarrow = c.widthPx < NARROW_SEGMENT_PX;
            const prevIsNarrow = i > 0 && computed[i - 1].widthPx < NARROW_SEGMENT_PX;
            const hasDivider = !isLast && !isNarrow && !prevIsNarrow;
            return (
              <button
                type="button"
                key={c.section.id}
                data-section-id={c.section.id}
                className={
                  'section-ribbon-seg' +
                  (hasDivider ? ' has-divider' : '') +
                  (activeSectionId === c.section.id ? ' active' : '')
                }
                style={{
                  left: `${c.leftPx}px`,
                  width: `${c.widthPx}px`,
                  backgroundColor: c.fillColor,
                }}
                title={c.label}
                onClick={(e) => {
                  if (!e.shiftKey) onSeek(c.section.start_ms / 1000);
                  onSelect(c.section);
                }}
                aria-label={c.label}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
