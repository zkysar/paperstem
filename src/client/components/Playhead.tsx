import { useRef, useState } from 'react';

const DRAG_THRESHOLD_PX = 4;

type Props = {
  visible: boolean;
  leftPx: number;
  clientXToLeftPx: (clientX: number) => number;
  clientXToTime: (clientX: number) => number;
  onSeek: (time: number) => void;
};

export function Playhead({
  visible,
  leftPx,
  clientXToLeftPx,
  clientXToTime,
  onSeek,
}: Props) {
  const [dragPx, setDragPx] = useState<number | null>(null);
  const dragRef = useRef<{ pointerId: number; originX: number; moved: boolean } | null>(null);

  if (!visible) return null;

  const renderLeft = dragPx ?? leftPx;

  function endDrag(commit: { clientX: number } | null) {
    const cur = dragRef.current;
    if (!cur) return;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKey);
    dragRef.current = null;
    setDragPx(null);
    if (commit && cur.moved) {
      onSeek(clientXToTime(commit.clientX));
    }
  }

  function onMove(e: PointerEvent) {
    const cur = dragRef.current;
    if (!cur || e.pointerId !== cur.pointerId) return;
    if (Math.abs(e.clientX - cur.originX) > DRAG_THRESHOLD_PX) cur.moved = true;
    setDragPx(clientXToLeftPx(e.clientX));
  }
  function onUp(e: PointerEvent) {
    const cur = dragRef.current;
    if (!cur || e.pointerId !== cur.pointerId) return;
    endDrag({ clientX: e.clientX });
  }
  function onCancel(e: PointerEvent) {
    const cur = dragRef.current;
    if (!cur || e.pointerId !== cur.pointerId) return;
    endDrag(null);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') endDrag(null);
  }

  function onHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if (dragRef.current) return;
    dragRef.current = { pointerId: e.pointerId, originX: e.clientX, moved: false };
    setDragPx(leftPx);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKey);
    e.preventDefault();
    e.stopPropagation();
  }

  return (
    <div className="playhead" style={{ left: `${renderLeft}px` }}>
      <div
        className="playhead-handle"
        onPointerDown={onHandlePointerDown}
        role="slider"
        aria-label="Playhead — drag to scrub"
      />
    </div>
  );
}
