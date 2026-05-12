import html2canvas from 'html2canvas-pro';

export type Screenshot = {
  blob: Blob;
  base64: string;
  width: number;
  height: number;
  dataUrl: string;
};

async function canvasToScreenshot(canvas: HTMLCanvasElement): Promise<Screenshot | null> {
  const dataUrl = canvas.toDataURL('image/png');
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png'),
  );
  if (!blob) return null;
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK) as unknown as number[],
    );
  }
  return {
    blob,
    base64: btoa(binary),
    width: canvas.width,
    height: canvas.height,
    dataUrl,
  };
}

export async function captureCurrentTab(
  ignoreSelector = '.bug-drawer, .bug-capture-overlay, .bug-cropper',
): Promise<Screenshot | null> {
  if (typeof document === 'undefined') return null;
  try {
    const canvasPromise = html2canvas(document.body, {
      backgroundColor: null,
      logging: false,
      // Bounds the wait when cross-origin fonts/images stall the fetch step;
      // without these the library hangs on Google Fonts CSS links.
      imageTimeout: 3000,
      useCORS: false,
      allowTaint: true,
      ignoreElements: (el) => {
        if (!ignoreSelector) return false;
        try {
          return el.matches(ignoreSelector);
        } catch {
          return false;
        }
      },
      // Render at the current devicePixelRatio for crisp output without
      // ballooning the payload past the server's 8MB cap.
      scale: Math.min(window.devicePixelRatio || 1, 2),
    });
    const canvas = await Promise.race([
      canvasPromise,
      new Promise<HTMLCanvasElement>((_, reject) =>
        setTimeout(() => reject(new Error('html2canvas timed out after 10s')), 10000),
      ),
    ]);
    return await canvasToScreenshot(canvas);
  } catch (err) {
    console.error('captureCurrentTab failed', err);
    return null;
  }
}

export type Rect = { x: number; y: number; w: number; h: number };

export async function cropScreenshot(
  source: Screenshot,
  rectInImagePx: Rect,
): Promise<Screenshot | null> {
  const { x, y, w, h } = rectInImagePx;
  const safeW = Math.max(1, Math.min(w, source.width - x));
  const safeH = Math.max(1, Math.min(h, source.height - y));
  const img = new Image();
  img.src = source.dataUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('failed to load source image for crop'));
  });
  const canvas = document.createElement('canvas');
  canvas.width = safeW;
  canvas.height = safeH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, x, y, safeW, safeH, 0, 0, safeW, safeH);
  return canvasToScreenshot(canvas);
}
