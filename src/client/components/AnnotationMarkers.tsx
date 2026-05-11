import { useMemo, type Dispatch, type SetStateAction } from 'react';
import type { Annotation } from '../../shared/types';
import { SELF_ANNOTATION_COLOR } from '../lib/colors';

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
