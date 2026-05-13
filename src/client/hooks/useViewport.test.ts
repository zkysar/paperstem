import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useViewport, MIN_TRACK_H, MAX_TRACK_H, MAX_HZOOM } from './useViewport';

describe('useViewport defaults', () => {
  it('starts at fit-to-window and default track height', () => {
    const { result } = renderHook(() => useViewport());
    expect(result.current.state.hZoom).toBe(1);
    expect(result.current.state.trackHeight).toBe(44);
    expect(result.current.state.scrollLeft).toBe(0);
    expect(result.current.state.followMode).toBe('smooth');
    expect(result.current.state.followActive).toBe(true);
    expect(result.current.state.minimapPref).toBe('auto');
  });
});

describe('useViewport.zoomH', () => {
  it('multiplies hZoom by 1.5 on zoomIn', () => {
    const { result } = renderHook(() => useViewport());
    act(() => result.current.zoomH('in', { stageWidth: 1000, anchorX: 0 }));
    expect(result.current.state.hZoom).toBeCloseTo(1.5);
  });

  it('clamps hZoom at 1.0 on zoomOut from fit', () => {
    const { result } = renderHook(() => useViewport());
    act(() => result.current.zoomH('out', { stageWidth: 1000, anchorX: 0 }));
    expect(result.current.state.hZoom).toBe(1);
  });

  it('clamps hZoom at MAX_HZOOM', () => {
    const { result } = renderHook(() => useViewport());
    for (let i = 0; i < 20; i++) {
      act(() => result.current.zoomH('in', { stageWidth: 1000, anchorX: 0 }));
    }
    expect(result.current.state.hZoom).toBe(MAX_HZOOM);
  });

  it('keeps anchor pixel stable when zooming with cursor at 0', () => {
    const { result } = renderHook(() => useViewport());
    act(() => result.current.zoomH('in', { stageWidth: 1000, anchorX: 0 }));
    expect(result.current.state.scrollLeft).toBe(0);
  });

  it('keeps anchor pixel stable when zooming with cursor at right edge', () => {
    const { result } = renderHook(() => useViewport());
    // First zoom in once so scrollLeft can become non-zero
    act(() => result.current.zoomH('in', { stageWidth: 1000, anchorX: 1000 }));
    // anchorX=1000, oldZoom=1, oldInnerWidth=1000, contentX=1000
    // newInnerWidth=1500, newScrollLeft = (1000/1000)*1500 - 1000 = 500
    expect(result.current.state.scrollLeft).toBe(500);
  });
});

describe('useViewport.zoomV', () => {
  it('grows track height by 1.5x on zoomIn, clamped to MAX_TRACK_H', () => {
    const { result } = renderHook(() => useViewport());
    act(() => result.current.zoomV('in'));
    expect(result.current.state.trackHeight).toBe(Math.round(44 * 1.5));
  });

  it('shrinks track height by 1.5x on zoomOut, clamped to MIN_TRACK_H', () => {
    const { result } = renderHook(() => useViewport());
    for (let i = 0; i < 10; i++) {
      act(() => result.current.zoomV('out'));
    }
    expect(result.current.state.trackHeight).toBe(MIN_TRACK_H);
  });
});

describe('useViewport.fitToWindow', () => {
  it('resets hZoom, scrollLeft, and trackHeight but not followMode', () => {
    const { result } = renderHook(() => useViewport());
    act(() => result.current.zoomH('in', { stageWidth: 1000, anchorX: 0 }));
    act(() => result.current.zoomV('in'));
    act(() => result.current.setFollowMode('page-flip'));
    act(() => result.current.fitToWindow());
    expect(result.current.state.hZoom).toBe(1);
    expect(result.current.state.scrollLeft).toBe(0);
    expect(result.current.state.trackHeight).toBe(44);
    expect(result.current.state.followMode).toBe('page-flip');
  });
});

describe('useViewport follow', () => {
  it('setFollowActive toggles followActive flag', () => {
    const { result } = renderHook(() => useViewport());
    act(() => result.current.setFollowActive(false));
    expect(result.current.state.followActive).toBe(false);
    act(() => result.current.setFollowActive(true));
    expect(result.current.state.followActive).toBe(true);
  });
});

describe('useViewport.setScrollLeft', () => {
  it('stores scroll value', () => {
    const { result } = renderHook(() => useViewport());
    act(() => result.current.setScrollLeft(123));
    expect(result.current.state.scrollLeft).toBe(123);
  });

  it('clamps negative scroll to 0', () => {
    const { result } = renderHook(() => useViewport());
    act(() => result.current.setScrollLeft(-50));
    expect(result.current.state.scrollLeft).toBe(0);
  });
});
