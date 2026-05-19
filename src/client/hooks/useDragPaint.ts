import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

export type PaintKind = 'mute' | 'solo';

interface UseDragPaintArgs {
  apply: (idx: number, kind: PaintKind, targetState: boolean) => void;
  readState: (idx: number, kind: PaintKind) => boolean;
}

interface Gesture {
  kind: PaintKind;
  targetState: boolean;
  painted: Set<number>;
}

const BODY_CLASS = 'dragging-vertical';

export function useDragPaint({ apply, readState }: UseDragPaintArgs) {
  const gestureRef = useRef<Gesture | null>(null);
  const applyRef = useRef(apply);
  const readStateRef = useRef(readState);
  applyRef.current = apply;
  readStateRef.current = readState;

  const endGesture = useCallback(() => {
    gestureRef.current = null;
    document.body.classList.remove(BODY_CLASS);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }, []);

  function onMouseMove(e: MouseEvent) {
    const g = gestureRef.current;
    if (!g) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    const row = (el as Element).closest('[data-track-idx]');
    if (!row) return;
    const raw = row.getAttribute('data-track-idx');
    if (raw === null) return;
    const idx = Number(raw);
    if (!Number.isFinite(idx) || g.painted.has(idx)) return;
    g.painted.add(idx);
    if (readStateRef.current(idx, g.kind) !== g.targetState) {
      applyRef.current(idx, g.kind, g.targetState);
    }
  }

  function onMouseUp() {
    endGesture();
  }

  const onPillMouseDown = useCallback(
    (idx: number, kind: PaintKind, e: ReactMouseEvent) => {
      // Left button only; let the browser context-menu or middle-click pass.
      if (e.button !== 0) return;
      e.preventDefault();
      // Defensive: if a previous gesture was somehow left dangling (e.g. the
      // mouseup was swallowed), tear it down before starting a new one so we
      // never leak document listeners.
      if (gestureRef.current) endGesture();
      const current = readStateRef.current(idx, kind);
      const targetState = !current;
      gestureRef.current = {
        kind,
        targetState,
        painted: new Set([idx]),
      };
      applyRef.current(idx, kind, targetState);
      document.body.classList.add(BODY_CLASS);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [],
  );

  // Safety: if the component using this hook unmounts mid-gesture, clean up.
  useEffect(() => {
    return () => {
      if (gestureRef.current) endGesture();
    };
  }, [endGesture]);

  return { onPillMouseDown };
}
