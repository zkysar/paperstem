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
  // past `holdMoveTolerance` before the timer fires dooms the gesture
  // (no drag, no tap). After arming, any pixel of motion commits the drag;
  // a release without ever moving also fires `onTap` so the user gets the
  // tap-equivalent action instead of a silent no-op.
  holdMs?: number;
  // Pre-arm movement tolerance (default 8). The 3px drag threshold is too
  // tight for the hold window — a slight wobble shouldn't kill the click.
  holdMoveTolerance?: number;
};

type State<P> = {
  startX: number;
  lastX: number;
  pointerId: number;
  target: Element;
  payload: P;
  // Drag has committed: at least one move past threshold (immediate-arm) or
  // any move after arming (hold).
  crossed: boolean;
  // Drag may begin: true from the start in immediate mode, set by the hold
  // timer in hold mode.
  armed: boolean;
  // The gesture was abandoned before the hold timer fired (user moved past
  // tolerance). Suppresses both onTap and onChange on release, and keeps
  // wasDragRef=true so the trailing native click is also suppressed.
  doomed: boolean;
  holdMs: number;
  holdMoveTolerance: number;
  holdTimer: ReturnType<typeof setTimeout> | null;
};

export function useDragOnAxis<P>(opts: UseDragOnAxisOpts<P>) {
  const threshold = opts.threshold ?? 3;
  const stateRef = useRef<State<P> | null>(null);
  const onChangeRef = useRef(opts.onChange);
  const onTapRef = useRef(opts.onTap);
  // True if the most recent gesture committed a drag, or was doomed by
  // pre-arm movement. Consumers read this in their click handler to
  // suppress the click that follows pointerup. Notably, hold-and-release
  // *without* moving leaves this false so a native onClick (if any) still
  // fires alongside onTap.
  const wasDragRef = useRef(false);
  // True between pointerdown and pointerup/cancel, regardless of whether a
  // drag actually committed. Consumers read this to suppress side effects on
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
      } else if (phase === 'commit' && onTapRef.current) {
        // Three sub-cases all land here as a tap:
        //   1. Immediate mode, never moved past threshold (legacy "click").
        //   2. Hold mode, released before timer (quick click).
        //   3. Hold mode, armed via timer but released without moving — the
        //      user committed to the hold but changed their mind; treat as
        //      a tap so they get the popover/select action instead of a
        //      silent dead gesture.
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
      const holdMoveTolerance = downOpts?.holdMoveTolerance ?? 8;
      const state: State<P> = {
        startX: e.clientX,
        lastX: e.clientX,
        pointerId: e.pointerId,
        target,
        payload,
        crossed: false,
        armed: holdMs === 0,
        doomed: false,
        holdMs,
        holdMoveTolerance,
        holdTimer: null,
      };
      if (holdMs > 0) {
        state.holdTimer = setTimeout(() => {
          if (stateRef.current !== state) return;
          state.armed = true;
          // Surface the armed state so consumers can apply the visual cue.
          // Intentionally do NOT set wasDragRef yet — that flips only when
          // movement actually starts the drag, so a hold-and-release without
          // motion still allows the trailing native click to land.
          setArmedPayload(state.payload);
        }, holdMs);
      }
      stateRef.current = state;
    },
    [],
  );

  // Clear any pending hold timer if the consumer unmounts mid-gesture, so
  // setArmedPayload doesn't fire against a dead component.
  useEffect(() => {
    return () => {
      const s = stateRef.current;
      if (s) clearHoldTimer(s);
    };
  }, []);

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const s = stateRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      s.lastX = e.clientX;
      const delta = e.clientX - s.startX;
      if (s.doomed) return;
      if (!s.armed) {
        // Hold pending: meaningful movement before the hold timer fires
        // dooms the gesture. wasDragRef stays true so the trailing native
        // click is also suppressed (the user clearly didn't want a click).
        if (Math.abs(delta) >= s.holdMoveTolerance) {
          clearHoldTimer(s);
          s.doomed = true;
          wasDragRef.current = true;
        }
        return;
      }
      // After arming via hold, any pixel of motion commits the drag. For
      // immediate-arm callers, keep the legacy threshold.
      const crossed =
        s.holdMs > 0 ? Math.abs(delta) > 0 : Math.abs(delta) >= threshold;
      if (!s.crossed && crossed) {
        s.crossed = true;
        wasDragRef.current = true;
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
