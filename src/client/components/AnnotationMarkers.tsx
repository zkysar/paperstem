import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';
import type { Annotation } from '../../shared/types';
import { SELF_ANNOTATION_COLOR } from '../lib/colors';
import { AnnotationHoverCard } from './AnnotationHoverCard';

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
  onLoopAnnotation,
  createMode,
}: Props) {
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

  // Internal popover-visibility state. Driven independently of the parent's
  // `hoveredId` (which exists for cross-component highlight coordination).
  const [activeHoverId, setActiveHoverId] = useState<string | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const markerRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    return () => {
      if (showTimerRef.current !== null)
        window.clearTimeout(showTimerRef.current);
      if (hideTimerRef.current !== null)
        window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  // If markers become hidden or create-mode kicks in, drop any active popover.
  useEffect(() => {
    if (!visible || createMode) {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      setActiveHoverId((cur) => (cur === null ? cur : null));
    }
  }, [visible, createMode]);

  function handleEnter(e: ReactPointerEvent<HTMLDivElement>, id: string) {
    if (e.pointerType === 'touch') return;
    if (createMode || !visible) return;
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (activeHoverId === id) return;
    if (showTimerRef.current !== null)
      window.clearTimeout(showTimerRef.current);
    showTimerRef.current = window.setTimeout(() => {
      showTimerRef.current = null;
      setActiveHoverId(id);
      onHover(id);
    }, 150);
  }

  function handleLeave(e: ReactPointerEvent<HTMLDivElement>, id: string) {
    if (e.pointerType === 'touch') return;
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (activeHoverId !== id) return;
    if (hideTimerRef.current !== null)
      window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setActiveHoverId((cur) => (cur === id ? null : cur));
      onHover((cur) => (cur === id ? null : cur));
    }, 100);
  }

  if (!markers.length) return null;

  const setMarkerRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) markerRefs.current.set(id, el);
    else markerRefs.current.delete(id);
  };

  const hoveredMarker = markers.find((m) => m.ann.id === activeHoverId);
  const hoverEl =
    hoveredMarker && markerRefs.current.get(hoveredMarker.ann.id);
  const hoverRect = hoverEl?.getBoundingClientRect();

  return (
    <>
      {markers.map((m) => {
        const isHighlighted =
          activeHoverId === m.ann.id || hoveredId === m.ann.id;
        const className =
          'annotation-marker ' +
          (m.isRegion ? 'region' : 'point') +
          (isHighlighted ? ' hovered' : '');
        const style: React.CSSProperties = m.isRegion
          ? {
              left: `${m.left}px`,
              width: `${m.width}px`,
              backgroundColor: m.color,
            }
          : {
              left: `${m.left}px`,
              backgroundColor: m.color,
            };
        return (
          <div
            key={m.ann.id}
            ref={setMarkerRef(m.ann.id)}
            data-testid={`annotation-marker-${m.ann.id}`}
            className={className}
            style={style}
            onPointerEnter={(e) => handleEnter(e, m.ann.id)}
            onPointerLeave={(e) => handleLeave(e, m.ann.id)}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(m.ann);
            }}
          />
        );
      })}
      {hoveredMarker &&
        hoverRect &&
        createPortal(
          <AnnotationHoverCard
            annotation={hoveredMarker.ann}
            color={hoveredMarker.color}
            anchorLeftPx={hoverRect.left + hoverRect.width / 2}
            anchorTopPx={hoverRect.top}
            onLoopRegion={() => onLoopAnnotation(hoveredMarker.ann)}
          />,
          document.body,
        )}
    </>
  );
}
