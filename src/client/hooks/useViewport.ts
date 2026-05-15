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
export type ZoomDir = 'in' | 'out';

export type ViewportState = {
  hZoom: number;
  trackHeight: number;
  scrollLeft: number;
  followMode: FollowMode;
  followActive: boolean;
  /** Outer .stage width in px, kept here so share-link snapshot/apply can
   *  read it without owning the DOM ref. Populated by Player via setStageWidth.
   *  0 until first measurement. */
  stageWidth: number;
  /** Width of the sticky track-name rail in px (0 when collapsed). */
  railWidth: number;
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
  /** Vertical-zoom analogue of zoomHBy — multiplies trackHeight directly. */
  zoomVBy(factor: number): void;
  setScrollLeft(px: number, maxScroll?: number): void;
  fitToWindow(): void;
  setFollowActive(active: boolean): void;
  setFollowMode(mode: FollowMode): void;
  setStageWidth(px: number): void;
  setRailWidth(px: number): void;
  /** Apply an absolute viewport state — used by share-link arrival to land
   *  the recipient at the sharer's zoom + scroll position. */
  setView(opts: { hZoom?: number; trackHeight?: number; scrollLeft?: number }): void;
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
    stageWidth: 0,
    railWidth: 0,
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

  const applyVerticalZoom = (prev: ViewportState, factor: number): ViewportState => {
    const target = prev.trackHeight * factor;
    const newHeight = Math.round(clamp(target, MIN_TRACK_H, MAX_TRACK_H));
    if (newHeight === prev.trackHeight) return prev;
    return { ...prev, trackHeight: newHeight };
  };

  const zoomV = useCallback((dir: ZoomDir) => {
    const factor = dir === 'in' ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    setState((prev) => applyVerticalZoom(prev, factor));
  }, []);

  const zoomVBy = useCallback((factor: number) => {
    setState((prev) => applyVerticalZoom(prev, factor));
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

  const setStageWidth = useCallback((px: number) => {
    setState((prev) => (prev.stageWidth === px ? prev : { ...prev, stageWidth: px }));
  }, []);

  const setRailWidth = useCallback((px: number) => {
    setState((prev) => (prev.railWidth === px ? prev : { ...prev, railWidth: px }));
  }, []);

  const setView = useCallback(
    (opts: { hZoom?: number; trackHeight?: number; scrollLeft?: number }) => {
      setState((prev) => {
        const next = { ...prev };
        if (opts.hZoom != null) {
          next.hZoom = clamp(opts.hZoom, MIN_HZOOM, MAX_HZOOM);
        }
        if (opts.trackHeight != null) {
          next.trackHeight = Math.round(clamp(opts.trackHeight, MIN_TRACK_H, MAX_TRACK_H));
        }
        if (opts.scrollLeft != null) {
          const inner = next.stageWidth * next.hZoom;
          const maxScroll = Math.max(0, inner - next.stageWidth);
          next.scrollLeft = clamp(opts.scrollLeft, 0, maxScroll);
        }
        return next;
      });
    },
    [],
  );

  return {
    state,
    zoomH,
    zoomHBy,
    zoomV,
    zoomVBy,
    setScrollLeft,
    fitToWindow,
    setFollowActive,
    setFollowMode,
    setStageWidth,
    setRailWidth,
    setView,
  };
}
