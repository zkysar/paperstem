import { useRef } from 'react';
import type { Annotation } from '../../shared/types';

type Props = {
  duration: number;
  hZoom: number;
  scrollLeft: number;
  viewportWidth: number;
  innerWidth: number;
  annotations: Annotation[];
  loop: { start: number; end: number } | null;
  currentTime: number;
  userColorMap: Map<string, string>;
  onSeek(t: number): void;
  onScrollTo(px: number): void;
};

export function Minimap({
  duration,
  hZoom,
  scrollLeft,
  viewportWidth,
  innerWidth,
  annotations,
  loop,
  currentTime,
  userColorMap,
  onScrollTo,
}: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; offsetWithinRect: number } | null>(
    null,
  );

  if (!duration) return null;

  // Geometry: the strip represents the full song width (innerWidth scaled to
  // 100%). The viewport rect is a window over that.
  const rectLeftPct = innerWidth > 0 ? (scrollLeft / innerWidth) * 100 : 0;
  const rectWidthPct = hZoom > 0 ? (1 / hZoom) * 100 : 100;
  const playheadPct = (currentTime / duration) * 100;

  function clickToScroll(clientX: number) {
    const strip = stripRef.current;
    if (!strip) return;
    const rect = strip.getBoundingClientRect();
    const fracX = (clientX - rect.left) / rect.width;
    // Target = center the rect on this fraction.
    const target = fracX * innerWidth - viewportWidth / 2;
    const max = Math.max(0, innerWidth - viewportWidth);
    onScrollTo(Math.max(0, Math.min(max, target)));
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.minimap-rect')) {
      // start drag
      const strip = stripRef.current;
      if (!strip) return;
      const stripRect = strip.getBoundingClientRect();
      const rectLeftPx = (rectLeftPct / 100) * stripRect.width;
      dragRef.current = {
        pointerId: e.pointerId,
        offsetWithinRect: e.clientX - stripRect.left - rectLeftPx,
      };
      const onMove = (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || ev.pointerId !== drag.pointerId) return;
        const strip2 = stripRef.current;
        if (!strip2) return;
        const r = strip2.getBoundingClientRect();
        const newLeftPx = ev.clientX - r.left - drag.offsetWithinRect;
        const fracLeft = newLeftPx / r.width;
        const next = fracLeft * innerWidth;
        const max = Math.max(0, innerWidth - viewportWidth);
        onScrollTo(Math.max(0, Math.min(max, next)));
      };
      const onUp = (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || ev.pointerId !== drag.pointerId) return;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        dragRef.current = null;
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    } else {
      clickToScroll(e.clientX);
    }
  }

  return (
    <div
      className="minimap-strip"
      ref={stripRef}
      onPointerDown={onPointerDown}
      role="presentation"
    >
      {loop && (
        <div
          className="minimap-loop"
          style={{
            left: `${(loop.start / duration) * 100}%`,
            width: `${((loop.end - loop.start) / duration) * 100}%`,
          }}
        />
      )}
      {annotations.map((a) => {
        const color = userColorMap.get(a.user_id) ?? '#888';
        return (
          <span
            key={a.id}
            className="minimap-dot"
            style={{
              left: `${(a.start_ms / 1000 / duration) * 100}%`,
              background: color,
            }}
            aria-hidden="true"
          />
        );
      })}
      <div
        className="minimap-rect"
        style={{ left: `${rectLeftPct}%`, width: `${rectWidthPct}%` }}
        aria-label="Visible window — drag to pan"
      />
      <div
        className="minimap-playhead"
        style={{ left: `${playheadPct}%` }}
        aria-hidden="true"
      />
    </div>
  );
}
