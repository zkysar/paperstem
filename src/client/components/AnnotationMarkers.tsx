import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { Annotation } from '../../shared/types';
import { SELF_ANNOTATION_COLOR } from '../lib/colors';
import { fmt } from '../lib/format';
import { useDragOnAxis } from '../hooks/useDragOnAxis';
import { DragGuideline } from './DragGuideline';

function authorLabel(a: Annotation): string {
  return a.user_display_name ?? a.user_email;
}

function markerTitle(a: Annotation): string {
  const who = authorLabel(a);
  const when = a.end_ms === null
    ? fmt(a.start_ms / 1000)
    : `${fmt(a.start_ms / 1000)} – ${fmt(a.end_ms / 1000)}`;
  const body = a.body.length > 120 ? a.body.slice(0, 117) + '…' : a.body;
  return `Comment by ${who} at ${when}\n${body}\n\nClick to open.`;
}

type Props = {
  annotations: Annotation[];
  duration: number;
  userColorMap: Map<string, string>;
  visible: boolean;
  waveLeftPx: number;
  waveWidthPx: number;
  onSelect(annotation: Annotation): void;
  hoveredId: string | null;
  onHover: Dispatch<SetStateAction<string | null>>;
  onLoopAnnotation(annotation: Annotation): void;
  createMode: boolean;
  selfUserId?: string;
  onPatchAnnotation?(
    id: string,
    input: { start_ms: number; end_ms: number | null },
  ): Promise<void>;
};

type DragPayload =
  | { kind: 'left'; id: string; baseStart: number; end: number | null; maxStart: number }
  | { kind: 'right'; id: string; start: number; baseEnd: number; minEnd: number; maxEnd: number }
  | { kind: 'middle'; id: string; baseStart: number; baseEnd: number | null; minDelta: number; maxDelta: number };

const MIN_REGION_MS = 100;
const SNAP_MS = 10;

function snap(v: number) { return Math.round(v / SNAP_MS) * SNAP_MS; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

export function AnnotationMarkers({
  annotations,
  duration,
  userColorMap,
  visible,
  waveLeftPx,
  waveWidthPx,
  onSelect,
  hoveredId,
  onHover,
  createMode,
  selfUserId,
  onPatchAnnotation,
}: Props) {
  const msPerPx = duration && waveWidthPx ? (duration * 1000) / waveWidthPx : 0;
  const durationMs = duration * 1000;
  const [provisional, setProvisional] = useState<
    Map<string, { start_ms: number; end_ms: number | null }>
  >(() => new Map());
  const [guideline, setGuideline] = useState<number | null>(null);

  const drag = useDragOnAxis<DragPayload>({
    threshold: 3,
    onChange: ({ phase, deltaPx, payload }) => {
      if (msPerPx <= 0) return;
      let nextStart: number;
      let nextEnd: number | null;
      if (payload.kind === 'left') {
        const cand = snap(payload.baseStart + deltaPx * msPerPx);
        nextStart = clamp(cand, 0, payload.maxStart);
        nextEnd = payload.end;
      } else if (payload.kind === 'right') {
        const cand = snap(payload.baseEnd + deltaPx * msPerPx);
        nextEnd = clamp(cand, payload.minEnd, payload.maxEnd);
        nextStart = payload.start;
      } else {
        let delta = snap(deltaPx * msPerPx);
        delta = clamp(delta, payload.minDelta, payload.maxDelta);
        nextStart = payload.baseStart + delta;
        nextEnd = payload.baseEnd === null ? null : payload.baseEnd + delta;
      }
      if (phase === 'preview') {
        setProvisional((cur) => {
          const m = new Map(cur);
          m.set(payload.id, { start_ms: nextStart, end_ms: nextEnd });
          return m;
        });
        setGuideline(waveLeftPx + (nextStart / durationMs) * waveWidthPx);
      } else {
        setProvisional((cur) => {
          const m = new Map(cur);
          m.delete(payload.id);
          return m;
        });
        setGuideline(null);
        if (phase === 'commit' && onPatchAnnotation) {
          void onPatchAnnotation(payload.id, { start_ms: nextStart, end_ms: nextEnd });
        }
      }
    },
  });

  const effective = (a: Annotation) =>
    provisional.get(a.id) ?? { start_ms: a.start_ms, end_ms: a.end_ms };

  const markers = useMemo(() => {
    if (!visible || !duration || !waveWidthPx) return [];
    return annotations.map((a) => {
      const { start_ms, end_ms } = effective(a);
      const color = userColorMap.get(a.user_id) ?? SELF_ANNOTATION_COLOR;
      const startFrac = Math.max(0, Math.min(1, start_ms / durationMs));
      const left = waveLeftPx + startFrac * waveWidthPx;
      if (end_ms === null) {
        return { ann: a, color, left, width: 0, isRegion: false, start_ms, end_ms };
      }
      const endFrac = Math.max(0, Math.min(1, end_ms / durationMs));
      const width = Math.max(2, (endFrac - startFrac) * waveWidthPx);
      return { ann: a, color, left, width, isRegion: true, start_ms, end_ms };
    });
  }, [annotations, visible, duration, waveWidthPx, userColorMap, waveLeftPx, durationMs, provisional]);

  if (!markers.length) return null;

  return (
    <>
      <DragGuideline visible={guideline !== null} leftPx={guideline ?? 0} />
      {markers.map((m) => {
        const isHovered = hoveredId === m.ann.id;
        const editable = !!selfUserId && selfUserId === m.ann.user_id;
        const className =
          'annotation-marker ' +
          (m.isRegion ? 'region' : 'point') +
          (isHovered ? ' hovered' : '');
        const style: React.CSSProperties = m.isRegion
          ? { left: `${m.left}px`, width: `${m.width}px`, backgroundColor: m.color }
          : { left: `${m.left}px`, backgroundColor: m.color };
        return (
          <div
            key={m.ann.id}
            data-testid={`annotation-marker-${m.ann.id}`}
            data-annotation-id={m.ann.id}
            className={className}
            style={style}
            title={markerTitle(m.ann)}
            aria-label={`Comment by ${authorLabel(m.ann)}`}
            onPointerEnter={() => { if (!createMode) onHover(m.ann.id); }}
            onPointerLeave={() => { onHover((cur) => (cur === m.ann.id ? null : cur)); }}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (createMode) return;
              if ((e.target as Element).closest('.annotation-grip')) return;
              if (!editable || !onPatchAnnotation) {
                onSelect(m.ann);
                return;
              }
              const baseEnd = m.end_ms;
              const minDelta = -m.start_ms;
              const maxDelta = baseEnd === null
                ? durationMs - m.start_ms
                : durationMs - baseEnd;
              drag.handlePointerDown(e, {
                kind: 'middle',
                id: m.ann.id,
                baseStart: m.start_ms,
                baseEnd,
                minDelta,
                maxDelta,
              });
            }}
          >
            {editable && m.isRegion && (
              <>
                <span
                  className="annotation-grip annotation-grip-left"
                  aria-hidden="true"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (m.end_ms === null) return;
                    drag.handlePointerDown(e, {
                      kind: 'left',
                      id: m.ann.id,
                      baseStart: m.start_ms,
                      end: m.end_ms,
                      maxStart: m.end_ms - MIN_REGION_MS,
                    });
                  }}
                />
                <span
                  className="annotation-grip annotation-grip-right"
                  aria-hidden="true"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (m.end_ms === null) return;
                    drag.handlePointerDown(e, {
                      kind: 'right',
                      id: m.ann.id,
                      start: m.start_ms,
                      baseEnd: m.end_ms,
                      minEnd: m.start_ms + MIN_REGION_MS,
                      maxEnd: durationMs,
                    });
                  }}
                />
              </>
            )}
          </div>
        );
      })}
    </>
  );
}
