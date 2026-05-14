import { useMemo, type Dispatch, type SetStateAction } from 'react';
import type { Annotation } from '../../shared/types';
import { SELF_ANNOTATION_COLOR } from '../lib/colors';
import { fmt } from '../lib/format';

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
};

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
}: Props) {
  const markers = useMemo(() => {
    if (!visible || !duration || !waveWidthPx) return [];
    const durationMs = duration * 1000;
    return annotations.map((a) => {
      const color = userColorMap.get(a.user_id) ?? SELF_ANNOTATION_COLOR;
      const startFrac = Math.max(0, Math.min(1, a.start_ms / durationMs));
      const left = waveLeftPx + startFrac * waveWidthPx;
      if (a.end_ms === null) {
        return { ann: a, color, left, width: 0, isRegion: false };
      }
      const endFrac = Math.max(0, Math.min(1, a.end_ms / durationMs));
      const width = Math.max(2, (endFrac - startFrac) * waveWidthPx);
      return { ann: a, color, left, width, isRegion: true };
    });
  }, [annotations, duration, userColorMap, visible, waveLeftPx, waveWidthPx]);

  if (!markers.length) return null;

  return (
    <>
      {markers.map((m) => {
        const isHovered = hoveredId === m.ann.id;
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
              onSelect(m.ann);
            }}
          />
        );
      })}
    </>
  );
}
