import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDragOnAxis } from './useDragOnAxis';

function makePointerEvent(type: string, clientX: number): PointerEvent {
  const ev = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperty(ev, 'clientX', { value: clientX, enumerable: true });
  Object.defineProperty(ev, 'clientY', { value: 0, enumerable: true });
  Object.defineProperty(ev, 'pointerId', { value: 1, enumerable: true });
  return ev;
}

describe('useDragOnAxis', () => {
  it('does not call onChange before 3px threshold is crossed', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useDragOnAxis({ threshold: 3, onChange }));

    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    act(() => {
      result.current.handlePointerDown(
        { ...makePointerEvent('pointerdown', 100), currentTarget: target } as any,
        { id: 'x' },
      );
    });

    act(() => {
      window.dispatchEvent(makePointerEvent('pointermove', 102)); // 2px — below threshold
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('fires preview when threshold crossed', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useDragOnAxis({ threshold: 3, onChange }));
    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    act(() => {
      result.current.handlePointerDown(
        { ...makePointerEvent('pointerdown', 100), currentTarget: target } as any,
        { id: 'x' },
      );
    });
    act(() => {
      window.dispatchEvent(makePointerEvent('pointermove', 110));
    });
    expect(onChange).toHaveBeenCalledWith({
      phase: 'preview',
      deltaPx: 10,
      payload: { id: 'x' },
    });
  });

  it('fires commit on pointerup when drag occurred', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useDragOnAxis({ threshold: 3, onChange }));
    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();
    act(() => {
      result.current.handlePointerDown(
        { ...makePointerEvent('pointerdown', 100), currentTarget: target } as any,
        { id: 'x' },
      );
    });
    act(() => {
      window.dispatchEvent(makePointerEvent('pointermove', 110));
      window.dispatchEvent(makePointerEvent('pointerup', 110));
    });
    expect(onChange).toHaveBeenLastCalledWith({
      phase: 'commit',
      deltaPx: 10,
      payload: { id: 'x' },
    });
  });

  it('fires cancel on Escape', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useDragOnAxis({ threshold: 3, onChange }));
    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();
    act(() => {
      result.current.handlePointerDown(
        { ...makePointerEvent('pointerdown', 100), currentTarget: target } as any,
        { id: 'x' },
      );
    });
    act(() => {
      window.dispatchEvent(makePointerEvent('pointermove', 110));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onChange).toHaveBeenLastCalledWith({
      phase: 'cancel',
      deltaPx: 10,
      payload: { id: 'x' },
    });
  });

  it('fires onTap when pointerup occurs before threshold', () => {
    const onChange = vi.fn();
    const onTap = vi.fn();
    const { result } = renderHook(() => useDragOnAxis({ threshold: 3, onChange, onTap }));
    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();
    act(() => {
      result.current.handlePointerDown(
        { ...makePointerEvent('pointerdown', 100), currentTarget: target } as any,
        { id: 'x' },
      );
    });
    act(() => {
      window.dispatchEvent(makePointerEvent('pointermove', 101));
      window.dispatchEvent(makePointerEvent('pointerup', 101));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(onTap).toHaveBeenCalledWith({ id: 'x' }, 101);
  });
});

describe('useDragOnAxis hold-to-arm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not arm a drag until the hold timer fires', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useDragOnAxis({ onChange }));
    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    act(() => {
      result.current.handlePointerDown(
        { ...makePointerEvent('pointerdown', 100), currentTarget: target } as any,
        { id: 'x' },
        { holdMs: 200 },
      );
    });
    // Movement before the timer would have been a drag in immediate mode;
    // here it should be silently no-op (movement-before-arm dooms the gesture).
    act(() => {
      window.dispatchEvent(makePointerEvent('pointermove', 130));
      window.dispatchEvent(makePointerEvent('pointerup', 130));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('pointerup before the hold timer fires as a tap', () => {
    const onChange = vi.fn();
    const onTap = vi.fn();
    const { result } = renderHook(() => useDragOnAxis({ onChange, onTap }));
    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    act(() => {
      result.current.handlePointerDown(
        { ...makePointerEvent('pointerdown', 100), currentTarget: target } as any,
        { id: 'x' },
        { holdMs: 200 },
      );
    });
    act(() => {
      vi.advanceTimersByTime(50);
      window.dispatchEvent(makePointerEvent('pointerup', 100));
    });
    expect(onTap).toHaveBeenCalledWith({ id: 'x' }, 100);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('after the hold timer fires, any movement starts the drag', () => {
    const onChange = vi.fn();
    const onTap = vi.fn();
    const { result } = renderHook(() => useDragOnAxis({ onChange, onTap }));
    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    act(() => {
      result.current.handlePointerDown(
        { ...makePointerEvent('pointerdown', 100), currentTarget: target } as any,
        { id: 'x' },
        { holdMs: 200 },
      );
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      window.dispatchEvent(makePointerEvent('pointermove', 105));
      window.dispatchEvent(makePointerEvent('pointerup', 105));
    });
    expect(onTap).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith({
      phase: 'commit',
      deltaPx: 5,
      payload: { id: 'x' },
    });
  });

  it('arming exposes the payload via armedPayload (for visual cue)', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useDragOnAxis({ onChange }));
    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    act(() => {
      result.current.handlePointerDown(
        { ...makePointerEvent('pointerdown', 100), currentTarget: target } as any,
        { id: 'x' },
        { holdMs: 200 },
      );
    });
    expect(result.current.armedPayload).toBeNull();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.armedPayload).toEqual({ id: 'x' });
    act(() => {
      window.dispatchEvent(makePointerEvent('pointerup', 100));
    });
    expect(result.current.armedPayload).toBeNull();
  });

  it('hold-then-release without movement fires onTap (user committed to hold then changed their mind)', () => {
    const onChange = vi.fn();
    const onTap = vi.fn();
    const { result } = renderHook(() => useDragOnAxis({ onChange, onTap }));
    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    act(() => {
      result.current.handlePointerDown(
        { ...makePointerEvent('pointerdown', 100), currentTarget: target } as any,
        { id: 'x' },
        { holdMs: 200 },
      );
    });
    act(() => {
      vi.advanceTimersByTime(200);
      window.dispatchEvent(makePointerEvent('pointerup', 100));
    });
    expect(onTap).toHaveBeenCalledWith({ id: 'x' }, 100);
    expect(onChange).not.toHaveBeenCalled();
    // wasDragRef must stay false so a trailing native click still fires
    // alongside onTap (used by SectionLane's onClick handler).
    expect(result.current.wasDragRef.current).toBe(false);
  });

  it('pre-arm movement up to holdMoveTolerance (8px) does NOT doom the gesture', () => {
    const onChange = vi.fn();
    const onTap = vi.fn();
    const { result } = renderHook(() => useDragOnAxis({ onChange, onTap }));
    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    act(() => {
      result.current.handlePointerDown(
        { ...makePointerEvent('pointerdown', 100), currentTarget: target } as any,
        { id: 'x' },
        { holdMs: 200 },
      );
    });
    // Slight jitter (7px) before the timer should not abort — release fires tap.
    act(() => {
      window.dispatchEvent(makePointerEvent('pointermove', 107));
      window.dispatchEvent(makePointerEvent('pointerup', 107));
    });
    expect(onTap).toHaveBeenCalledWith({ id: 'x' }, 107);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('pointercancel ends the gesture the same way pointerup does', () => {
    const onChange = vi.fn();
    const onTap = vi.fn();
    const { result } = renderHook(() => useDragOnAxis({ onChange, onTap }));
    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    act(() => {
      result.current.handlePointerDown(
        { ...makePointerEvent('pointerdown', 100), currentTarget: target } as any,
        { id: 'x' },
        { holdMs: 200 },
      );
    });
    act(() => {
      vi.advanceTimersByTime(200);
      window.dispatchEvent(makePointerEvent('pointermove', 110));
      window.dispatchEvent(makePointerEvent('pointercancel', 110));
    });
    expect(onChange).toHaveBeenLastCalledWith({
      phase: 'commit',
      deltaPx: 10,
      payload: { id: 'x' },
    });
  });

  it('unmount mid-hold clears the pending timer (no late setState)', () => {
    const onChange = vi.fn();
    const { result, unmount } = renderHook(() => useDragOnAxis({ onChange }));
    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    act(() => {
      result.current.handlePointerDown(
        { ...makePointerEvent('pointerdown', 100), currentTarget: target } as any,
        { id: 'x' },
        { holdMs: 200 },
      );
    });
    // Unmount before the timer fires — the cleanup effect should clear it.
    unmount();
    // Advance past the original deadline; nothing should throw or warn.
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
  });
});
