import { useEffect, useRef, useState } from 'react';
import { computePeaks, loadCachedPeaks, saveCachedPeaks } from '../lib/peaks';

type Props = {
  stemId: string | null;
};

export function WaveformThumb({ stemId }: Props) {
  const [peaks, setPeaks] = useState<number[] | null>(() =>
    stemId ? loadCachedPeaks(stemId) : null,
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!stemId) {
      setPeaks(null);
      return;
    }
    const cached = loadCachedPeaks(stemId);
    if (cached) {
      setPeaks(cached);
      return;
    }
    setPeaks(null);

    const Ctor: typeof AudioContext | undefined =
      typeof window === 'undefined'
        ? undefined
        : window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
    if (!Ctor) return;

    const ac = new AbortController();
    let cancelled = false;
    let ctx: AudioContext | null = null;

    void (async () => {
      try {
        const res = await fetch(`/api/audio/${encodeURIComponent(stemId)}`, {
          credentials: 'include',
          signal: ac.signal,
        });
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        ctx = new Ctor();
        const audio = await ctx.decodeAudioData(buf);
        if (cancelled) return;
        const next = computePeaks(audio);
        saveCachedPeaks(stemId, next);
        setPeaks(next);
      } catch {
        // network/decode failures fall back to placeholder
      } finally {
        if (ctx) void ctx.close();
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [stemId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.offsetWidth || 110;
    const cssH = canvas.clientHeight || canvas.offsetHeight || 18;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const g = canvas.getContext('2d');
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, cssW, cssH);
    g.fillStyle = getComputedStyle(canvas).color || '#888';
    const n = peaks.length;
    const barW = cssW / n;
    const mid = cssH / 2;
    for (let i = 0; i < n; i++) {
      const h = Math.max(1, peaks[i] * cssH);
      g.fillRect(i * barW, mid - h / 2, Math.max(1, barW - 0.5), h);
    }
  }, [peaks]);

  if (!peaks) return <span className="fp-thumb" aria-hidden="true" />;
  return (
    <canvas
      ref={canvasRef}
      className="fp-thumb-canvas"
      aria-hidden="true"
      data-testid="fp-waveform"
    />
  );
}
