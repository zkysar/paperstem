import { useMemo, useState, useCallback } from 'react';
import { Link2 } from 'lucide-react';
import type { Section } from '../../shared/types';
import { FREE_TEXT_SECTION_COLOR, colorForSong } from '../lib/colors';
import { useDragOnAxis } from '../hooks/useDragOnAxis';
import { DragGuideline } from './DragGuideline';

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

type LeftEdgePayload = {
  kind: 'left-edge';
  sectionId: string;
  baseStartMs: number;
  minStartMs: number;
  maxStartMs: number;
};

const NARROW_SEGMENT_PX = 8;
const MIN_GAP_MS = 250;
const SNAP_MS = 10;

function snap(v: number): number {
  return Math.round(v / SNAP_MS) * SNAP_MS;
}

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
  const [provisional, setProvisional] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [guideline, setGuideline] = useState<number | null>(null);

  const msPerPx = duration && waveWidthPx ? (duration * 1000) / waveWidthPx : 0;

  const drag = useDragOnAxis<LeftEdgePayload>({
    threshold: 3,
    onChange: ({ phase, deltaPx, payload }) => {
      if (msPerPx <= 0) return;
      const candidate = snap(payload.baseStartMs + deltaPx * msPerPx);
      const next = Math.max(
        payload.minStartMs,
        Math.min(payload.maxStartMs, candidate),
      );
      if (phase === 'preview') {
        setProvisional((cur) => {
          const m = new Map(cur);
          m.set(payload.sectionId, next);
          return m;
        });
        setGuideline(waveLeftPx + (next / (duration * 1000)) * waveWidthPx);
      } else {
        setProvisional((cur) => {
          const m = new Map(cur);
          m.delete(payload.sectionId);
          return m;
        });
        setGuideline(null);
        if (phase === 'commit' && onPatchSection) {
          void onPatchSection(payload.sectionId, { start_ms: next });
        }
      }
    },
  });

  const effective = useCallback(
    (s: Section): number => provisional.get(s.id) ?? s.start_ms,
    [provisional],
  );

  const computed = useMemo(() => {
    if (!duration || !waveWidthPx || sections.length === 0) return [];
    const durationMs = duration * 1000;
    const sorted = [...sections].sort((a, b) => effective(a) - effective(b));
    const laneRightPx = waveLeftPx + waveWidthPx;
    return sorted.map((section, i) => {
      const prev = sorted[i - 1];
      const next = sorted[i + 1];
      const startMs = effective(section);
      const endMs = next ? effective(next) : durationMs;
      const startFrac = Math.max(0, Math.min(1, startMs / durationMs));
      const endFrac = Math.max(0, Math.min(1, endMs / durationMs));
      let leftPx = waveLeftPx + startFrac * waveWidthPx;
      const widthPx = Math.max(4, (endFrac - startFrac) * waveWidthPx);
      if (leftPx + widthPx > laneRightPx) {
        leftPx = Math.max(waveLeftPx, laneRightPx - widthPx);
      }
      const fillColor = section.song_id
        ? colorForSong(section.song_id)
        : FREE_TEXT_SECTION_COLOR;
      const shared =
        !!section.song_id &&
        (songUseCounts.get(section.song_id) ?? 0) > 1;
      return {
        section,
        index: i,
        prevStartMs: prev ? effective(prev) : 0,
        nextStartMs: next ? effective(next) : durationMs,
        leftPx,
        widthPx,
        fillColor,
        label: labelFor(section),
        shared,
      };
    });
  }, [sections, duration, waveWidthPx, waveLeftPx, songUseCounts, effective]);

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
      <div className="section-rail-mask" aria-hidden="true" />
      {expanded ? (
        <div className="section-lane" aria-label="Song sections">
          <DragGuideline visible={guideline !== null} leftPx={guideline ?? 0} />
          {computed.map((c) => {
            const isActive = activeSectionId === c.section.id;
            const showGrips = !!onPatchSection;
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
                  if (!e.shiftKey) onSeek(c.section.start_ms / 1000);
                  onSelect(c.section);
                }}
              >
                {showGrips && c.index > 0 && (
                  <span
                    className="section-grip section-grip-left"
                    aria-hidden="true"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      drag.handlePointerDown(e, {
                        kind: 'left-edge',
                        sectionId: c.section.id,
                        baseStartMs: effective(c.section),
                        minStartMs: c.prevStartMs + MIN_GAP_MS,
                        maxStartMs: c.nextStartMs - MIN_GAP_MS,
                      });
                    }}
                  />
                )}
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
