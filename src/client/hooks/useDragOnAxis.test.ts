import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useDragOnAxis } from './useDragOnAxis';

function makePointerEvent(type: string, clientX: number): PointerEvent {
  const ev = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperty(ev, 'clientX', { value: clientX });
  Object.defineProperty(ev, 'clientY', { value: 0 });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
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
});
