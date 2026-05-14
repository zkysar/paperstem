/**
 * Touch-pinch zoom adapter for the timeline viewport.
 *
 * Listens for Safari's non-standard GestureEvents (iOS / iPad) and falls
 * back to two-touch TouchEvents (Android Chrome and any non-Safari touch
 * browser that doesn't fire `gesture*`). Each pinch frame is reported as
 * an incremental `scaleDelta` so the consumer can pass it straight to a
 * multiplicative zoom API like `viewport.zoomHBy`.
 *
 * The handler calls preventDefault on each event so Safari doesn't also
 * perform its native page zoom.
 */

export type PinchFrame = {
  /** Multiplier vs. the previous frame. 1.0 = no change. */
  scaleDelta: number;
  /** Viewport-relative X of the pinch midpoint, in CSS pixels. */
  clientX: number;
};

type GestureEventLike = Event & {
  scale: number;
  clientX: number;
  preventDefault(): void;
};

function hasGestureEvents(): boolean {
  return typeof (window as unknown as { GestureEvent?: unknown }).GestureEvent
    !== 'undefined';
}

export function attachPinchZoom(
  el: HTMLElement,
  onFrame: (frame: PinchFrame) => void,
): () => void {
  if (hasGestureEvents()) {
    return attachGesture(el, onFrame);
  }
  return attachTouch(el, onFrame);
}

function attachGesture(
  el: HTMLElement,
  onFrame: (frame: PinchFrame) => void,
): () => void {
  let lastScale = 1;

  function onStart(ev: Event) {
    const e = ev as GestureEventLike;
    e.preventDefault();
    lastScale = e.scale || 1;
  }
  function onChange(ev: Event) {
    const e = ev as GestureEventLike;
    e.preventDefault();
    const scale = e.scale || 1;
    if (lastScale === 0) {
      lastScale = scale;
      return;
    }
    const scaleDelta = scale / lastScale;
    lastScale = scale;
    onFrame({ scaleDelta, clientX: e.clientX });
  }
  function onEnd(ev: Event) {
    (ev as GestureEventLike).preventDefault();
    lastScale = 1;
  }

  el.addEventListener('gesturestart', onStart, { passive: false });
  el.addEventListener('gesturechange', onChange, { passive: false });
  el.addEventListener('gestureend', onEnd, { passive: false });
  return () => {
    el.removeEventListener('gesturestart', onStart);
    el.removeEventListener('gesturechange', onChange);
    el.removeEventListener('gestureend', onEnd);
  };
}

function touchDistance(a: Touch, b: Touch): number {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy);
}

function touchMidX(a: Touch, b: Touch): number {
  return (a.clientX + b.clientX) / 2;
}

function attachTouch(
  el: HTMLElement,
  onFrame: (frame: PinchFrame) => void,
): () => void {
  let lastDistance = 0;
  let active = false;

  function onStart(e: TouchEvent) {
    // Any transition that doesn't leave us with exactly two contacts
    // invalidates the pinch — including a third finger landing. Without
    // this, the 3→2 finger transition reuses a stale lastDistance and
    // emits a huge spurious scaleDelta on the next touchmove.
    if (e.touches.length !== 2) {
      active = false;
      lastDistance = 0;
      return;
    }
    const [a, b] = [e.touches[0], e.touches[1]];
    lastDistance = touchDistance(a, b);
    active = lastDistance > 0;
    if (active) e.preventDefault();
  }
  function onMove(e: TouchEvent) {
    if (!active || e.touches.length !== 2) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    const distance = touchDistance(a, b);
    if (distance === 0 || lastDistance === 0) return;
    e.preventDefault();
    const scaleDelta = distance / lastDistance;
    lastDistance = distance;
    onFrame({ scaleDelta, clientX: touchMidX(a, b) });
  }
  function onEnd(e: TouchEvent) {
    // Any contact-count change other than "still exactly two" ends the
    // pinch. Going 3→2 must reset rather than resume mid-stride.
    if (e.touches.length !== 2) {
      active = false;
      lastDistance = 0;
    }
  }

  el.addEventListener('touchstart', onStart, { passive: false });
  el.addEventListener('touchmove', onMove, { passive: false });
  el.addEventListener('touchend', onEnd);
  el.addEventListener('touchcancel', onEnd);
  return () => {
    el.removeEventListener('touchstart', onStart);
    el.removeEventListener('touchmove', onMove);
    el.removeEventListener('touchend', onEnd);
    el.removeEventListener('touchcancel', onEnd);
  };
}
