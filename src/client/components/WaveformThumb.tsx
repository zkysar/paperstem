import { useEffect, useRef, useState } from 'react';
import {
  computePeaks,
  loadCachedPeaks,
  saveCachedPeaks,
  thumbPeaksFromWire,
} from '../lib/peaks';
import { acquire } from '../lib/concurrency';

type Props = {
  stemId: string | null;
  // Server-stored peaks (wire string) for this stem. When present, the
  // thumbnail renders from these directly — no audio download or decode, which
  // is what makes thumbnails reliable on mobile.
  peaks?: string | null;
};

export function WaveformThumb({ stemId, peaks: wirePeaks }: Props) {
  const [peaks, setPeaks] = useState<number[] | null>(
    () =>
      thumbPeaksFromWire(wirePeaks) ??
      (stemId ? loadCachedPeaks(stemId) : null),
  );
  const [visible, setVisible] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Mark visible when the wrapper scrolls into view (or immediately if IO is
  // unavailable). Off-screen rows in a long band stay placeholder until the
  // user scrolls them in.
  useEffect(() => {
    if (visible) return;
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '100px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    // Prefer the server's precomputed peaks: instant, and no audio fetch/decode
    // (the step that fails on mobile). Falls through to the decode path only
    // for stems with no stored peaks.
    const fromWire = thumbPeaksFromWire(wirePeaks);
    if (fromWire) {
      setPeaks(fromWire);
      return;
    }
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
    if (!visible) return;

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
    let release: (() => void) | null = null;

    void (async () => {
      release = await acquire();
      if (cancelled) return;
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
        if (release) release();
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [stemId, visible, wirePeaks]);

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

  return (
    <span ref={wrapRef} className="fp-thumb" aria-hidden="true">
      {peaks && (
        <canvas
          ref={canvasRef}
          className="fp-thumb-canvas"
          data-testid="fp-waveform"
        />
      )}
    </span>
  );
}
