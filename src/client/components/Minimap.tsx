import { useRef } from 'react';
import type { Annotation } from '../../shared/types';

type Props = {
  duration: number;
  hZoom: number;
  scrollLeft: number;
  viewportWidth: number;
  innerWidth: number;
  /** Width of the song (wave) area in viewport-inner coords — i.e.
   *  innerWidth - railWidth. The minimap's strip represents the full song
   *  mapped over this length, NOT the full innerWidth (which would include
   *  the unrelated rail column). */
  waveWidth: number;
  /** Visible wave area width on screen (stageWidth - railWidth). */
  visibleWaveWidth: number;
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
  waveWidth,
  visibleWaveWidth,
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

  // Geometry: the strip's width represents the full song (waveWidth in the
  // main timeline's content coords). The viewport rect is a window over
  // that, sized to match the currently visible wave area.
  const rectLeftPct = waveWidth > 0 ? (scrollLeft / waveWidth) * 100 : 0;
  const rectWidthPct = waveWidth > 0
    ? Math.min(100, (visibleWaveWidth / waveWidth) * 100)
    : 100;
  const playheadPct = (currentTime / duration) * 100;
  // Suppress unused-prop warnings — these are still in the contract for
  // callers but the math no longer needs them here.
  void hZoom; void innerWidth; void viewportWidth;

  function clickToScroll(clientX: number) {
    const strip = stripRef.current;
    if (!strip) return;
    const rect = strip.getBoundingClientRect();
    const fracX = (clientX - rect.left) / rect.width;
    // fracX is the song-time fraction the user clicked. Scroll so that
    // time fraction lands at the center of the visible wave area.
    const targetX = fracX * waveWidth;
    const target = targetX - visibleWaveWidth / 2;
    const max = Math.max(0, waveWidth - visibleWaveWidth);
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
        const next = fracLeft * waveWidth;
        const max = Math.max(0, waveWidth - visibleWaveWidth);
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
