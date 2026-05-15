import { useCallback, useEffect, useRef } from 'react';

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

type State<P> = {
  startX: number;
  lastX: number;
  pointerId: number;
  target: Element;
  payload: P;
  crossed: boolean;
};

export function useDragOnAxis<P>(opts: UseDragOnAxisOpts<P>) {
  const threshold = opts.threshold ?? 3;
  const stateRef = useRef<State<P> | null>(null);
  const onChangeRef = useRef(opts.onChange);
  const onTapRef = useRef(opts.onTap);
  // True if the most recent drag crossed the threshold. Consumers read this
  // in their click handler to suppress the click that follows pointerup.
  const wasDragRef = useRef(false);

  onChangeRef.current = opts.onChange;
  onTapRef.current = opts.onTap;

  const finish = useCallback((phase: 'commit' | 'cancel') => {
    const s = stateRef.current;
    if (!s) return;
    try {
      s.target.releasePointerCapture(s.pointerId);
    } catch {
      /* ignore */
    }
    if (s.crossed) {
      onChangeRef.current({ phase, deltaPx: s.lastX - s.startX, payload: s.payload });
    } else if (phase === 'commit' && onTapRef.current) {
      onTapRef.current(s.payload, s.lastX);
    }
    stateRef.current = null;
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, payload: P) => {
      const target = e.currentTarget;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      wasDragRef.current = false;
      stateRef.current = {
        startX: e.clientX,
        lastX: e.clientX,
        pointerId: e.pointerId,
        target,
        payload,
        crossed: false,
      };
    },
    [],
  );

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const s = stateRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      s.lastX = e.clientX;
      const delta = e.clientX - s.startX;
      if (!s.crossed && Math.abs(delta) >= threshold) {
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

  return { handlePointerDown, wasDragRef };
}
