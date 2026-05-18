import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
type MiddlePayload = {
  kind: 'middle';
  sectionId: string;
  nextId: string | null;
  baseStartMs: number;
  baseNextStartMs: number;
  minDelta: number;
  maxDelta: number;
};
type DragPayload = LeftEdgePayload | MiddlePayload;

const NARROW_SEGMENT_PX = 8;
const MIN_GAP_MS = 250;
const SNAP_MS = 10;
// Long-press delay (ms) before the section pill's middle-drag arms. A quick
// click stays a click → seek + select; a deliberate hold floats the pill and
// lets the user drag it. The left-edge grip is immediate-drag (no hold).
const HOLD_MS = 200;

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
  // Tracks the pill the user is currently pressing so we can stamp it with a
  // `.dragging` class. Annotation markers and loop regions rely on the CSS
  // `:active` pseudo-class to swap their cursor to `grabbing`, but a section
  // pill is a <button>, and Chromium drops `:active` on a button as soon as
  // the pointer leaves the element's bounding box — even while pointer
  // capture is active — so during a drag the cursor flickers back to `grab`.
  // Explicit state keeps the grabbing cursor on for the whole gesture.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  useEffect(() => {
    if (!draggingId) return;
    const clear = () => setDraggingId(null);
    window.addEventListener('pointerup', clear);
    window.addEventListener('pointercancel', clear);
    return () => {
      window.removeEventListener('pointerup', clear);
      window.removeEventListener('pointercancel', clear);
    };
  }, [draggingId]);

  // Cursor lock: pointer-capture continues delivering events after the
  // cursor leaves the 12px grip strip, but the rendered cursor reverts to
  // whatever element is under it (grab on the pill, default on empty
  // space). Setting the cursor on documentElement for the duration of an
  // active left-edge drag keeps ew-resize stable across the whole gesture.
  const priorCursorRef = useRef<string | null>(null);

  function lockCursor() {
    if (priorCursorRef.current !== null) return;
    priorCursorRef.current = document.documentElement.style.cursor;
    document.documentElement.style.cursor = 'ew-resize';
  }

  function unlockCursor() {
    if (priorCursorRef.current === null) return;
    document.documentElement.style.cursor = priorCursorRef.current;
    priorCursorRef.current = null;
  }

  useEffect(() => {
    return () => {
      // Safety: clear the lock if the component unmounts mid-drag.
      unlockCursor();
    };
  }, []);

  // Cursor-anchored label chip. Mouse only — touch already has a tap-to-expand
  // affordance and a chip floating under the finger would be obscured.
  // Keyboard focus uses the same chip anchored to the element's bounding box,
  // so sighted keyboard users can still surface labels (the old `title=`
  // tooltip would have provided this but the custom chip replaced it).
  const [hoverChip, setHoverChip] = useState<
    { label: string; x: number; y: number } | null
  >(null);
  const showHoverChip = useCallback(
    (e: React.PointerEvent, label: string) => {
      if (e.pointerType !== 'mouse') return;
      setHoverChip({ label, x: e.clientX, y: e.clientY });
    },
    [],
  );
  const showFocusChip = useCallback(
    (e: React.FocusEvent<HTMLElement>, label: string) => {
      const r = e.currentTarget.getBoundingClientRect();
      setHoverChip({ label, x: r.left + r.width / 2, y: r.bottom });
    },
    [],
  );
  const clearHoverChip = useCallback(() => setHoverChip(null), []);
  useEffect(() => {
    if (draggingId) setHoverChip(null);
  }, [draggingId]);
  // Right-click and tab-away don't always emit pointerleave — clear the chip
  // on the events that would otherwise strand it on screen.
  useEffect(() => {
    if (!hoverChip) return;
    const onHidden = () => setHoverChip(null);
    window.addEventListener('blur', onHidden);
    window.addEventListener('contextmenu', onHidden);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('blur', onHidden);
      window.removeEventListener('contextmenu', onHidden);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [hoverChip]);

  const msPerPx = duration && waveWidthPx ? (duration * 1000) / waveWidthPx : 0;

  const drag = useDragOnAxis<DragPayload>({
    threshold: 3,
    onChange: ({ phase, deltaPx, payload }) => {
      if (msPerPx <= 0) return;
      if (payload.kind === 'left-edge') {
        const candidate = snap(payload.baseStartMs + deltaPx * msPerPx);
        const next = Math.max(
          payload.minStartMs,
          Math.min(payload.maxStartMs, candidate),
        );
        if (phase === 'preview') {
          lockCursor();
          setProvisional((cur) => {
            const m = new Map(cur);
            m.set(payload.sectionId, next);
            return m;
          });
          setGuideline(waveLeftPx + (next / (duration * 1000)) * waveWidthPx);
        } else {
          unlockCursor();
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
        return;
      }
      let delta = snap(deltaPx * msPerPx);
      delta = Math.max(payload.minDelta, Math.min(payload.maxDelta, delta));
      const nextStart = payload.baseStartMs + delta;
      const nextNextStart = payload.baseNextStartMs + delta;
      if (phase === 'preview') {
        setProvisional((cur) => {
          const m = new Map(cur);
          m.set(payload.sectionId, nextStart);
          if (payload.nextId) m.set(payload.nextId, nextNextStart);
          return m;
        });
        setGuideline(waveLeftPx + (nextStart / (duration * 1000)) * waveWidthPx);
      } else if (phase === 'commit' && onPatchSection) {
        // After a middle drag we open the section popover at the dropped
        // position, mirroring how a click on the pill opens it for editing.
        // The pill's anchor lookup (data-section-id getBoundingClientRect)
        // needs to find it at the *new* position, so we keep `provisional`
        // in place until the patches resolve and the parent re-fetches the
        // canonical start_ms — then the optimistic state and real state
        // coincide and we can drop the provisional entry without a flicker.
        const promises = [
          onPatchSection(payload.sectionId, { start_ms: nextStart }),
        ];
        if (payload.nextId) {
          promises.push(
            onPatchSection(payload.nextId, { start_ms: nextNextStart }),
          );
        }
        void Promise.allSettled(promises).then(() => {
          setProvisional((cur) => {
            const m = new Map(cur);
            m.delete(payload.sectionId);
            if (payload.nextId) m.delete(payload.nextId);
            return m;
          });
        });
        setGuideline(null);
        const dragged = sections.find((s) => s.id === payload.sectionId);
        if (dragged) onSelect({ ...dragged, start_ms: nextStart });
      } else {
        setProvisional((cur) => {
          const m = new Map(cur);
          m.delete(payload.sectionId);
          if (payload.nextId) m.delete(payload.nextId);
          return m;
        });
        setGuideline(null);
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
      onMouseLeave={() => {
        // A horizontal drag often drifts a few pixels vertically out of the
        // 22px wrap. If we collapsed the lane on that mouseLeave the pill
        // we're dragging would unmount mid-gesture and the drag would die.
        if (drag.isActiveRef.current) return;
        onHoverChange(false);
      }}
      onPointerDown={(e) => {
        // Only count taps that land on an actual section element — tapping
        // empty space in the wrap shouldn't expand the lane.
        if (expanded) return;
        const target = e.target as Element | null;
        if (target && target.closest('.section-ribbon-seg, .section-pill')) {
          onTapToExpand();
        }
      }}
    >
      <div className="section-rail-mask" aria-hidden="true" />
      {expanded ? (
        <div
          className="section-lane"
          aria-label="Song sections"
          // Re-entry while expanded (e.g. activeSectionId set, cursor re-enters
          // a pill area) needs to re-set hover=true. Leave is handled by the wrap.
          onMouseEnter={() => onHoverChange(true)}
        >
          <DragGuideline visible={guideline !== null} leftPx={guideline ?? 0} />
          {computed.map((c) => {
            const isActive = activeSectionId === c.section.id;
            const isArmed =
              drag.armedPayload?.kind === 'middle' &&
              drag.armedPayload.sectionId === c.section.id;
            const showGrips = !!onPatchSection;
            const fullLabel = c.section.song_name
              ? c.shared
                ? `${c.section.song_name} · used in ${songUseCounts.get(c.section.song_id ?? '') ?? 1} practices`
                : c.section.song_name
              : c.section.label ?? 'Untitled boundary';
            return (
              <button
                type="button"
                key={c.section.id}
                data-testid={`section-${c.section.id}`}
                data-section-id={c.section.id}
                className={
                  'section-pill' +
                  (isActive ? ' active' : '') +
                  (draggingId === c.section.id ? ' dragging' : '') +
                  (isArmed ? ' armed' : '')
                }
                style={{
                  left: `${c.leftPx}px`,
                  width: `${c.widthPx}px`,
                  backgroundColor: c.fillColor,
                }}
                aria-label={fullLabel}
                onPointerEnter={(e) => showHoverChip(e, fullLabel)}
                onPointerMove={(e) => showHoverChip(e, fullLabel)}
                onPointerLeave={clearHoverChip}
                onFocus={(e) => showFocusChip(e, fullLabel)}
                onBlur={clearHoverChip}
                onClick={(e) => {
                  if (drag.wasDragRef.current) return;
                  if (!e.shiftKey) onSeek(c.section.start_ms / 1000);
                  onSelect(c.section);
                }}
                onPointerDown={(e) => {
                  if (!onPatchSection) return;
                  // Touch pointers conflict with scroll/seek and lack the
                  // precision the grip affordance assumes — edit on desktop.
                  if (e.pointerType === 'touch') return;
                  if ((e.target as Element).closest('.section-grip')) return;
                  setDraggingId(c.section.id);
                  const hasNext = c.index + 1 < computed.length;
                  const baseStart = effective(c.section);
                  const baseNextStart = c.nextStartMs;
                  const nextId = hasNext ? computed[c.index + 1].section.id : null;

                  const minDelta = Math.max(
                    -baseStart,
                    c.prevStartMs + MIN_GAP_MS - baseStart,
                  );

                  // For non-last sections, both self and next translate by
                  // the same delta so width stays constant — max delta is
                  // bounded by where the next section's next would collide.
                  // For the last section, there is no next start to push,
                  // so the section grows or shrinks against the song's end.
                  const durationMs = duration * 1000;
                  let maxDelta: number;
                  if (hasNext) {
                    const nextOfNextStart =
                      c.index + 2 < computed.length
                        ? effective(computed[c.index + 2].section)
                        : durationMs;
                    maxDelta = nextOfNextStart - MIN_GAP_MS - baseNextStart;
                  } else {
                    maxDelta = durationMs - MIN_GAP_MS - baseStart;
                  }

                  drag.handlePointerDown(
                    e,
                    {
                      kind: 'middle',
                      sectionId: c.section.id,
                      nextId,
                      baseStartMs: baseStart,
                      baseNextStartMs: baseNextStart,
                      minDelta,
                      maxDelta,
                    },
                    { holdMs: HOLD_MS },
                  );
                }}
              >
                {showGrips && c.index > 0 && (
                  <span
                    className="section-grip section-grip-left"
                    aria-hidden="true"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (e.pointerType === 'touch') return;
                      setDraggingId(c.section.id);
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
                {showGrips && c.index < computed.length - 1 && (
                  <span
                    className="section-grip section-grip-right"
                    aria-hidden="true"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (e.pointerType === 'touch') return;
                      // Stamp `.dragging` on the pill the user is touching,
                      // not on the pill whose start_ms moves — the cursor
                      // hovers over THIS pill's edge.
                      setDraggingId(c.section.id);
                      const next = computed[c.index + 1];
                      drag.handlePointerDown(e, {
                        kind: 'left-edge',
                        sectionId: next.section.id,
                        baseStartMs: effective(next.section),
                        minStartMs: next.prevStartMs + MIN_GAP_MS,
                        maxStartMs: next.nextStartMs - MIN_GAP_MS,
                      });
                    }}
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
                onClick={(e) => {
                  if (!e.shiftKey) onSeek(c.section.start_ms / 1000);
                  onSelect(c.section);
                }}
                onMouseEnter={() => onHoverChange(true)}
                onPointerEnter={(e) => showHoverChip(e, c.label)}
                onPointerMove={(e) => showHoverChip(e, c.label)}
                onPointerLeave={clearHoverChip}
                onFocus={(e) => showFocusChip(e, c.label)}
                onBlur={clearHoverChip}
                aria-label={c.label}
              />
            );
          })}
        </div>
      )}
      {hoverChip &&
        createPortal(
          <SectionHoverChip
            label={hoverChip.label}
            x={hoverChip.x}
            y={hoverChip.y}
          />,
          document.body,
        )}
    </div>
  );
}

function SectionHoverChip({
  label,
  x,
  y,
}: {
  label: string;
  x: number;
  y: number;
}) {
  // Clamp so the chip never spills past the right viewport edge. The chip is
  // measured after first paint; pre-measurement we just offset from the cursor.
  const CURSOR_OFFSET_X = 12;
  const CURSOR_OFFSET_Y = 16;
  const left = Math.min(x + CURSOR_OFFSET_X, window.innerWidth - 12);
  const top = Math.min(y + CURSOR_OFFSET_Y, window.innerHeight - 12);
  return (
    <div
      className="section-hover-chip"
      role="tooltip"
      style={{ left: `${left}px`, top: `${top}px` }}
    >
      {label}
    </div>
  );
}
