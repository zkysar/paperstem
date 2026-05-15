export function fmt(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Compact duration string from a millisecond count: "4:32" under an hour,
// "1:02:30" otherwise. Returns '' for null/invalid so callers can blank out
// the cell when no stem has yet been measured.
export function formatDurationMs(ms: number | null): string {
  if (ms == null || !isFinite(ms) || ms < 0) return '';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function pixelToTime(localPx: number, widthPx: number, durationSec: number): number {
  if (!durationSec || !widthPx) return 0;
  return clamp((localPx / widthPx) * durationSec, 0, durationSec);
}

// Short human-friendly date string for list views: "Today", "Yesterday",
// "14 May" within the current calendar year, otherwise "14 May 2025". Empty
// string when no timestamp is available so callers can render '' as a blank.
export function formatRelativeDate(epochMs: number, now: number = Date.now()): string {
  if (!epochMs || !isFinite(epochMs)) return '';
  const d = new Date(epochMs);
  const today = new Date(now);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  const yesterday = new Date(now - 24 * 60 * 60 * 1000);
  if (sameDay(d, yesterday)) return 'Yesterday';
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === today.getFullYear()
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat(undefined, opts).format(d);
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
