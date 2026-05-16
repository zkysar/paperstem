import { useCallback, useEffect, useRef, useState } from 'react';

export type DragPhase = 'preview' | 'commit' | 'cancel';

export type DragChange<P> = {
  phase: DragPhase;
  deltaPx: number;
  payload: P;
};

export type UseDragOnAxisOpts<P> = {
  threshold?: number;
  onChange(change: DragChange<P>): void;
  onTap?(payload: P, clientX: number): void;
};

export type PointerDownOpts = {
  // When > 0, the gesture must be held still for this many ms before the
  // drag arms. A pointerup before the timer fires triggers `onTap`; movement
  // past `threshold` before the timer fires cancels silently (no tap, no
  // drag). After arming, any pixel of motion commits the drag.
  holdMs?: number;
};

type State<P> = {
  startX: number;
  lastX: number;
  pointerId: number;
  target: Element;
  payload: P;
  crossed: boolean;
  armed: boolean;
  tapEligible: boolean;
  doomed: boolean;
  holdMs: number;
  holdTimer: ReturnType<typeof setTimeout> | null;
};

export function useDragOnAxis<P>(opts: UseDragOnAxisOpts<P>) {
  const threshold = opts.threshold ?? 3;
  const stateRef = useRef<State<P> | null>(null);
  const onChangeRef = useRef(opts.onChange);
  const onTapRef = useRef(opts.onTap);
  // True if the most recent drag crossed the threshold or armed via hold.
  // Consumers read this in their click handler to suppress the click that
  // follows pointerup.
  const wasDragRef = useRef(false);
  // True between pointerdown and pointerup/cancel, regardless of whether the
  // threshold was crossed. Consumers read this to suppress side effects on
  // surrounding elements (e.g. a hover-driven collapse) that would otherwise
  // unmount the drag target mid-gesture.
  const isActiveRef = useRef(false);
  // Currently-armed payload, exposed so consumers can render a visual cue
  // (e.g. a lifted "floating" effect) while a hold-to-drag is engaged.
  const [armedPayload, setArmedPayload] = useState<P | null>(null);

  onChangeRef.current = opts.onChange;
  onTapRef.current = opts.onTap;

  const clearHoldTimer = (s: State<P>) => {
    if (s.holdTimer) {
      clearTimeout(s.holdTimer);
      s.holdTimer = null;
    }
  };

  const finish = useCallback((phase: 'commit' | 'cancel') => {
    const s = stateRef.current;
    if (!s) return;
    clearHoldTimer(s);
    try {
      s.target.releasePointerCapture(s.pointerId);
    } catch {
      /* ignore */
    }
    if (!s.doomed) {
      if (s.crossed) {
        onChangeRef.current({ phase, deltaPx: s.lastX - s.startX, payload: s.payload });
      } else if (phase === 'commit' && s.tapEligible && onTapRef.current) {
        onTapRef.current(s.payload, s.lastX);
      }
    }
    stateRef.current = null;
    isActiveRef.current = false;
    setArmedPayload(null);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, payload: P, downOpts?: PointerDownOpts) => {
      const target = e.currentTarget;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      wasDragRef.current = false;
      isActiveRef.current = true;
      const holdMs = downOpts?.holdMs ?? 0;
      const state: State<P> = {
        startX: e.clientX,
        lastX: e.clientX,
        pointerId: e.pointerId,
        target,
        payload,
        crossed: false,
        // No hold required → drag is immediately armed (legacy behavior).
        armed: holdMs === 0,
        tapEligible: true,
        doomed: false,
        holdMs,
        holdTimer: null,
      };
      if (holdMs > 0) {
        state.holdTimer = setTimeout(() => {
          if (stateRef.current !== state) return;
          state.armed = true;
          state.tapEligible = false;
          wasDragRef.current = true;
          setArmedPayload(state.payload);
        }, holdMs);
      }
      stateRef.current = state;
    },
    [],
  );

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const s = stateRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      s.lastX = e.clientX;
      const delta = e.clientX - s.startX;
      if (s.doomed) return;
      if (!s.armed) {
        // Hold pending: meaningful movement before the hold timer fires
        // dooms the gesture — neither drag nor tap should fire.
        if (Math.abs(delta) >= threshold) {
          clearHoldTimer(s);
          s.doomed = true;
          s.tapEligible = false;
        }
        return;
      }
      // After arming via hold, any pixel of motion starts the drag. For
      // legacy immediate-arm callers, keep the original threshold.
      const crossed =
        s.holdMs > 0 ? Math.abs(delta) > 0 : Math.abs(delta) >= threshold;
      if (!s.crossed && crossed) {
        s.crossed = true;
        wasDragRef.current = true;
        s.tapEligible = false;
      }
      if (s.crossed) {
        onChangeRef.current({ phase: 'preview', deltaPx: delta, payload: s.payload });
      }
    }
    function onPointerUp(e: PointerEvent) {
      const s = stateRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      finish('commit');
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') finish('cancel');
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [finish, threshold]);

  return { handlePointerDown, wasDragRef, isActiveRef, armedPayload };
}
