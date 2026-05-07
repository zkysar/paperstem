import { useMemo, useState } from 'react';
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
};

const TOOLTIP_BODY_LIMIT = 80;

function bodyPreview(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length <= TOOLTIP_BODY_LIMIT) return trimmed;
  return trimmed.slice(0, TOOLTIP_BODY_LIMIT) + '…';
}

export function AnnotationMarkers({
  annotations,
  duration,
  userColorMap,
  visible,
  waveLeftPx,
  waveWidthPx,
  onSelect,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const markers = useMemo(() => {
    if (!visible) return [];
    if (!duration || !waveWidthPx) return [];
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
        const author = m.ann.user_display_name ?? m.ann.user_email;
        const tooltip = `${author}\n${bodyPreview(m.ann.body)}`;
        if (m.isRegion) {
          return (
            <div
              key={m.ann.id}
              className={
                'annotation-marker region' +
                (hoveredId === m.ann.id ? ' hovered' : '')
              }
              style={{
                left: `${m.left}px`,
                width: `${m.width}px`,
                backgroundColor: m.color,
              }}
              title={tooltip}
              onPointerEnter={() => setHoveredId(m.ann.id)}
              onPointerLeave={() =>
                setHoveredId((cur) => (cur === m.ann.id ? null : cur))
              }
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(m.ann);
              }}
            />
          );
        }
        return (
          <div
            key={m.ann.id}
            className={
              'annotation-marker point' +
              (hoveredId === m.ann.id ? ' hovered' : '')
            }
            style={{
              left: `${m.left}px`,
              backgroundColor: m.color,
            }}
            title={tooltip}
            onPointerEnter={() => setHoveredId(m.ann.id)}
            onPointerLeave={() =>
              setHoveredId((cur) => (cur === m.ann.id ? null : cur))
            }
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(m.ann);
            }}
          />
        );
      })}
    </>
  );
}
