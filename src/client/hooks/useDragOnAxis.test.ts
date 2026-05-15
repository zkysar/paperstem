import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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
