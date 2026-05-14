import { afterEach, describe, expect, test, vi } from 'vitest';
import { attachPinchZoom, type PinchFrame } from './touch-pinch';

const originalGestureEvent = (window as unknown as { GestureEvent?: unknown }).GestureEvent;

afterEach(() => {
  if (originalGestureEvent === undefined) {
    delete (window as unknown as { GestureEvent?: unknown }).GestureEvent;
  } else {
    (window as unknown as { GestureEvent?: unknown }).GestureEvent = originalGestureEvent;
  }
});

function makeTouch(clientX: number, clientY: number, id = clientX): Touch {
  return {
    identifier: id,
    clientX,
    clientY,
    pageX: clientX,
    pageY: clientY,
    screenX: clientX,
    screenY: clientY,
    radiusX: 1,
    radiusY: 1,
    rotationAngle: 0,
    force: 1,
    target: document.body,
  } as Touch;
}

function fireTouch(
  el: HTMLElement,
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  touches: Touch[],
): TouchEvent {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  Object.defineProperty(ev, 'touches', { value: touches });
  Object.defineProperty(ev, 'targetTouches', { value: touches });
  Object.defineProperty(ev, 'changedTouches', { value: touches });
  el.dispatchEvent(ev);
  return ev;
}

function fireGesture(
  el: HTMLElement,
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  clientX: number,
): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'scale', { value: scale });
  Object.defineProperty(ev, 'clientX', { value: clientX });
  el.dispatchEvent(ev);
  return ev;
}

describe('attachPinchZoom (GestureEvent path)', () => {
  test('emits incremental scaleDelta and clientX on gesturechange', () => {
    (window as unknown as { GestureEvent: unknown }).GestureEvent = function () {};
    const el = document.createElement('div');
    document.body.appendChild(el);
    const frames: PinchFrame[] = [];
    const detach = attachPinchZoom(el, (f) => frames.push(f));

    fireGesture(el, 'gesturestart', 1, 200);
    fireGesture(el, 'gesturechange', 1.5, 210);
    fireGesture(el, 'gesturechange', 3, 220);

    expect(frames).toHaveLength(2);
    expect(frames[0].scaleDelta).toBeCloseTo(1.5, 5);
    expect(frames[0].clientX).toBe(210);
    expect(frames[1].scaleDelta).toBeCloseTo(2, 5);
    expect(frames[1].clientX).toBe(220);

    detach();
    document.body.removeChild(el);
  });

  test('preventDefault is called on each gesture event', () => {
    (window as unknown as { GestureEvent: unknown }).GestureEvent = function () {};
    const el = document.createElement('div');
    document.body.appendChild(el);
    const detach = attachPinchZoom(el, vi.fn());

    const start = fireGesture(el, 'gesturestart', 1, 100);
    const change = fireGesture(el, 'gesturechange', 1.2, 100);
    const end = fireGesture(el, 'gestureend', 1.2, 100);

    expect(start.defaultPrevented).toBe(true);
    expect(change.defaultPrevented).toBe(true);
    expect(end.defaultPrevented).toBe(true);

    detach();
    document.body.removeChild(el);
  });

  test('detach removes listeners', () => {
    (window as unknown as { GestureEvent: unknown }).GestureEvent = function () {};
    const el = document.createElement('div');
    document.body.appendChild(el);
    const onFrame = vi.fn();
    const detach = attachPinchZoom(el, onFrame);
    detach();

    fireGesture(el, 'gesturestart', 1, 100);
    fireGesture(el, 'gesturechange', 1.5, 100);

    expect(onFrame).not.toHaveBeenCalled();
    document.body.removeChild(el);
  });
});

describe('attachPinchZoom (TouchEvent fallback)', () => {
  test('emits scaleDelta from two-finger pinch distance', () => {
    delete (window as unknown as { GestureEvent?: unknown }).GestureEvent;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const frames: PinchFrame[] = [];
    const detach = attachPinchZoom(el, (f) => frames.push(f));

    fireTouch(el, 'touchstart', [makeTouch(0, 0, 1), makeTouch(100, 0, 2)]);
    fireTouch(el, 'touchmove', [makeTouch(0, 0, 1), makeTouch(200, 0, 2)]);
    fireTouch(el, 'touchmove', [makeTouch(0, 0, 1), makeTouch(400, 0, 2)]);

    expect(frames).toHaveLength(2);
    expect(frames[0].scaleDelta).toBeCloseTo(2, 5);
    expect(frames[0].clientX).toBeCloseTo(100, 5);
    expect(frames[1].scaleDelta).toBeCloseTo(2, 5);
    expect(frames[1].clientX).toBeCloseTo(200, 5);

    detach();
    document.body.removeChild(el);
  });

  test('ignores moves when not in a 2-touch gesture', () => {
    delete (window as unknown as { GestureEvent?: unknown }).GestureEvent;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const onFrame = vi.fn();
    const detach = attachPinchZoom(el, onFrame);

    fireTouch(el, 'touchstart', [makeTouch(0, 0, 1)]);
    fireTouch(el, 'touchmove', [makeTouch(50, 0, 1)]);

    expect(onFrame).not.toHaveBeenCalled();

    detach();
    document.body.removeChild(el);
  });

  test('preventDefault on touchstart and touchmove during pinch', () => {
    delete (window as unknown as { GestureEvent?: unknown }).GestureEvent;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const detach = attachPinchZoom(el, vi.fn());

    const start = fireTouch(el, 'touchstart', [makeTouch(0, 0, 1), makeTouch(100, 0, 2)]);
    const move = fireTouch(el, 'touchmove', [makeTouch(0, 0, 1), makeTouch(200, 0, 2)]);

    expect(start.defaultPrevented).toBe(true);
    expect(move.defaultPrevented).toBe(true);

    detach();
    document.body.removeChild(el);
  });

  test('third finger landing resets state — no spurious jump on 3→2 transition', () => {
    delete (window as unknown as { GestureEvent?: unknown }).GestureEvent;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const frames: PinchFrame[] = [];
    const detach = attachPinchZoom(el, (f) => frames.push(f));

    // Start a normal 2-touch pinch.
    fireTouch(el, 'touchstart', [makeTouch(0, 0, 1), makeTouch(100, 0, 2)]);
    fireTouch(el, 'touchmove', [makeTouch(0, 0, 1), makeTouch(200, 0, 2)]);
    expect(frames).toHaveLength(1);

    // Third finger lands — pinch should end.
    fireTouch(el, 'touchstart', [
      makeTouch(0, 0, 1),
      makeTouch(200, 0, 2),
      makeTouch(50, 50, 3),
    ]);
    // While 3 fingers are down, moves are ignored.
    fireTouch(el, 'touchmove', [
      makeTouch(0, 0, 1),
      makeTouch(200, 0, 2),
      makeTouch(50, 50, 3),
    ]);
    expect(frames).toHaveLength(1);

    // Third finger lifts back to 2 — a stale-distance frame would have
    // emitted a giant scaleDelta here. After the fix, the pinch stays
    // ended until a fresh touchstart re-arms it.
    fireTouch(el, 'touchend', [makeTouch(0, 0, 1), makeTouch(200, 0, 2)]);
    fireTouch(el, 'touchmove', [makeTouch(0, 0, 1), makeTouch(400, 0, 2)]);
    expect(frames).toHaveLength(1);

    detach();
    document.body.removeChild(el);
  });

  test('resets state when fingers lift', () => {
    delete (window as unknown as { GestureEvent?: unknown }).GestureEvent;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const frames: PinchFrame[] = [];
    const detach = attachPinchZoom(el, (f) => frames.push(f));

    fireTouch(el, 'touchstart', [makeTouch(0, 0, 1), makeTouch(100, 0, 2)]);
    fireTouch(el, 'touchmove', [makeTouch(0, 0, 1), makeTouch(200, 0, 2)]);
    fireTouch(el, 'touchend', []);

    fireTouch(el, 'touchmove', [makeTouch(0, 0, 1), makeTouch(400, 0, 2)]);

    expect(frames).toHaveLength(1);

    detach();
    document.body.removeChild(el);
  });
});
