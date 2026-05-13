import { useCallback, useState } from 'react';

export const MIN_TRACK_H = 22;
export const MAX_TRACK_H = 160;
export const DEFAULT_TRACK_H = 44;
export const MIN_HZOOM = 1;
export const MAX_HZOOM = 32;
export const ZOOM_FACTOR = 1.5;
/** Per-event step for trackpad/wheel zoom. Smaller than the keyboard step
 *  (ZOOM_FACTOR) because trackpads emit many wheel events per gesture; using
 *  the keyboard factor here makes scroll-zoom feel runaway-fast. */
export const WHEEL_ZOOM_FACTOR = 1.1;

export type FollowMode = 'smooth' | 'page-flip';
/** Minimap visibility preference, cycled by the toolbar button:
 *  - `auto`: shown only when hZoom > 1 (the default, since there's nothing
 *    to pan at fit-to-window)
 *  - `off`: never shown
 *  - `pinned`: always shown, even at hZoom === 1 — useful for jumping with
 *    a single click to a song region when not yet zoomed in */
export type MinimapPref = 'auto' | 'off' | 'pinned';
export type ZoomDir = 'in' | 'out';

export type ViewportState = {
  hZoom: number;
  trackHeight: number;
  scrollLeft: number;
  followMode: FollowMode;
  followActive: boolean;
  minimapPref: MinimapPref;
};

export type ZoomHOpts = {
  stageWidth: number;
  anchorX: number;
};

export type ViewportControls = {
  state: ViewportState;
  zoomH(dir: ZoomDir, opts: ZoomHOpts): void;
  /** Zoom horizontally by an arbitrary multiplier (used by trackpad/wheel
   *  zoom, where a small per-event factor avoids the runaway-zoom feel of
   *  the 1.5× keyboard step). */
  zoomHBy(factor: number, opts: ZoomHOpts): void;
  zoomV(dir: ZoomDir): void;
  setScrollLeft(px: number, maxScroll?: number): void;
  fitToWindow(): void;
  setFollowActive(active: boolean): void;
  setFollowMode(mode: FollowMode): void;
  setMinimapPref(pref: MinimapPref): void;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function useViewport(): ViewportControls {
  const [state, setState] = useState<ViewportState>({
    hZoom: MIN_HZOOM,
    trackHeight: DEFAULT_TRACK_H,
    scrollLeft: 0,
    followMode: 'smooth',
    followActive: true,
    minimapPref: 'auto',
  });

  const applyHorizontalZoom = (
    prev: ViewportState,
    factor: number,
    opts: ZoomHOpts,
  ): ViewportState => {
    const oldZoom = prev.hZoom;
    const target = oldZoom * factor;
    const newZoom = clamp(target, MIN_HZOOM, MAX_HZOOM);
    if (newZoom === oldZoom) return prev;
    const { stageWidth, anchorX } = opts;
    const oldInner = stageWidth * oldZoom;
    const newInner = stageWidth * newZoom;
    const contentX = anchorX + prev.scrollLeft;
    const rawScroll = oldInner > 0
      ? (contentX / oldInner) * newInner - anchorX
      : 0;
    const maxScroll = Math.max(0, newInner - stageWidth);
    return {
      ...prev,
      hZoom: newZoom,
      scrollLeft: clamp(rawScroll, 0, maxScroll),
    };
  };

  const zoomH = useCallback((dir: ZoomDir, opts: ZoomHOpts) => {
    const factor = dir === 'in' ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    setState((prev) => applyHorizontalZoom(prev, factor, opts));
  }, []);

  const zoomHBy = useCallback((factor: number, opts: ZoomHOpts) => {
    setState((prev) => applyHorizontalZoom(prev, factor, opts));
  }, []);

  const zoomV = useCallback((dir: ZoomDir) => {
    setState((prev) => {
      const target = dir === 'in'
        ? prev.trackHeight * ZOOM_FACTOR
        : prev.trackHeight / ZOOM_FACTOR;
      const newHeight = Math.round(clamp(target, MIN_TRACK_H, MAX_TRACK_H));
      if (newHeight === prev.trackHeight) return prev;
      return { ...prev, trackHeight: newHeight };
    });
  }, []);

  const setScrollLeft = useCallback((px: number, maxScroll?: number) => {
    setState((prev) => {
      const hi = maxScroll ?? Infinity;
      return { ...prev, scrollLeft: clamp(px, 0, hi) };
    });
  }, []);

  const fitToWindow = useCallback(() => {
    setState((prev) => ({
      ...prev,
      hZoom: MIN_HZOOM,
      trackHeight: DEFAULT_TRACK_H,
      scrollLeft: 0,
      followActive: true,
    }));
  }, []);

  const setFollowActive = useCallback((active: boolean) => {
    setState((prev) => ({ ...prev, followActive: active }));
  }, []);

  const setFollowMode = useCallback((mode: FollowMode) => {
    setState((prev) => ({ ...prev, followMode: mode }));
  }, []);

  const setMinimapPref = useCallback((pref: MinimapPref) => {
    setState((prev) => ({ ...prev, minimapPref: pref }));
  }, []);

  return {
    state,
    zoomH,
    zoomHBy,
    zoomV,
    setScrollLeft,
    fitToWindow,
    setFollowActive,
    setFollowMode,
    setMinimapPref,
  };
}
