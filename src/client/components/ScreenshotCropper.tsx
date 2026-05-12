import { useCallback, useEffect, useRef, useState } from 'react';
import { cropScreenshot, type Rect, type Screenshot } from '../lib/captureScreenshot';

type Props = {
  source: Screenshot;
  onUse(result: Screenshot): void;
  onCancel(): void;
};

export function ScreenshotCropper({ source, onUse, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const [imgRect, setImgRect] = useState<DOMRect | null>(null);

  const recomputeImgRect = useCallback(() => {
    if (imgRef.current) setImgRect(imgRef.current.getBoundingClientRect());
  }, []);

  useEffect(() => {
    recomputeImgRect();
    window.addEventListener('resize', recomputeImgRect);
    return () => window.removeEventListener('resize', recomputeImgRect);
  }, [recomputeImgRect]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function toImgCoords(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    if (!imgRect) return null;
    const scaleX = source.width / imgRect.width;
    const scaleY = source.height / imgRect.height;
    const x = Math.max(0, Math.min(imgRect.width, e.clientX - imgRect.left)) * scaleX;
    const y = Math.max(0, Math.min(imgRect.height, e.clientY - imgRect.top)) * scaleY;
    return { x, y };
  }

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    recomputeImgRect();
    const p = toImgCoords(e);
    if (!p) return;
    setDragStart(p);
    setRect({ x: p.x, y: p.y, w: 0, h: 0 });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragStart) return;
    const p = toImgCoords(e);
    if (!p) return;
    const x = Math.min(dragStart.x, p.x);
    const y = Math.min(dragStart.y, p.y);
    const w = Math.abs(p.x - dragStart.x);
    const h = Math.abs(p.y - dragStart.y);
    setRect({ x, y, w, h });
  }

  function onPointerUp() {
    setDragStart(null);
  }

  async function handleUseSelection(): Promise<void> {
    if (!rect || rect.w < 4 || rect.h < 4) return;
    setBusy(true);
    try {
      const cropped = await cropScreenshot(source, rect);
      if (cropped) onUse(cropped);
    } finally {
      setBusy(false);
    }
  }

  function handleUseFull(): void {
    onUse(source);
  }

  // Compute display-space rect for the selection overlay.
  let displayRect: { left: number; top: number; w: number; h: number } | null = null;
  if (rect && imgRect) {
    const scaleX = imgRect.width / source.width;
    const scaleY = imgRect.height / source.height;
    displayRect = {
      left: rect.x * scaleX,
      top: rect.y * scaleY,
      w: rect.w * scaleX,
      h: rect.h * scaleY,
    };
  }

  const hasSelection = rect !== null && rect.w >= 4 && rect.h >= 4;

  return (
    <div className="bug-cropper" role="dialog" aria-label="Crop screenshot">
      <div className="bug-cropper-instructions">
        Drag on the image to select an area, or use the whole capture. Esc to cancel.
      </div>
      <div className="bug-cropper-stage" ref={containerRef}>
        <div className="bug-cropper-image-wrap">
          <img
            ref={imgRef}
            src={source.dataUrl}
            alt="Captured screenshot"
            className="bug-cropper-image"
            draggable={false}
            onLoad={recomputeImgRect}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          {displayRect && (
            <div
              className="bug-cropper-selection"
              style={{
                left: displayRect.left,
                top: displayRect.top,
                width: displayRect.w,
                height: displayRect.h,
              }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>
      <div className="bug-cropper-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" onClick={handleUseFull} disabled={busy}>
          Use full image
        </button>
        <button
          type="button"
          className="bug-cropper-primary"
          onClick={() => void handleUseSelection()}
          disabled={!hasSelection || busy}
        >
          {busy ? 'Cropping…' : 'Use selection'}
        </button>
      </div>
    </div>
  );
}
