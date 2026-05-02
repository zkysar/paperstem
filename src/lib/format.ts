export function fmt(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function pixelToTime(localPx: number, widthPx: number, durationSec: number): number {
  if (!durationSec || !widthPx) return 0;
  return clamp((localPx / widthPx) * durationSec, 0, durationSec);
}

export function longestStemIdx(durations: number[]): number {
  let idx = 0;
  let best = -Infinity;
  for (let i = 0; i < durations.length; i++) {
    const d = durations[i];
    if (isFinite(d) && d > best) {
      best = d;
      idx = i;
    }
  }
  return idx;
}
