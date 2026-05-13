import { useCallback, useState } from 'react';

export const MIN_TRACK_H = 22;
export const MAX_TRACK_H = 160;
export const DEFAULT_TRACK_H = 44;
export const MIN_HZOOM = 1;
export const MAX_HZOOM = 32;
export const ZOOM_FACTOR = 1.5;

export type FollowMode = 'smooth' | 'page-flip';
export type MinimapPref = 'auto' | 'off';
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

  const zoomH = useCallback((dir: ZoomDir, opts: ZoomHOpts) => {
    setState((prev) => {
      const oldZoom = prev.hZoom;
      const target = dir === 'in' ? oldZoom * ZOOM_FACTOR : oldZoom / ZOOM_FACTOR;
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
    });
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
    zoomV,
    setScrollLeft,
    fitToWindow,
    setFollowActive,
    setFollowMode,
    setMinimapPref,
  };
}
