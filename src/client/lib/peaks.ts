// Peaks: tiny per-stem amplitude envelope, sized for the picker thumbnail
// (~110px wide). Computed once from the decoded AudioBuffer, normalized 0..1,
// cached in localStorage as 0..255 ints to keep entries under a few hundred
// bytes.

const CACHE_PREFIX = 'paperstem:peaks:v1:';
export const PEAK_BINS = 110;

export function computePeaks(buffer: AudioBuffer, bins: number = PEAK_BINS): number[] {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }
  const length = buffer.length;
  if (length === 0 || channels.length === 0) {
    return new Array(bins).fill(0);
  }
  const samplesPerBin = Math.max(1, Math.floor(length / bins));
  const out = new Array<number>(bins);
  for (let i = 0; i < bins; i++) {
    const start = i * samplesPerBin;
    const end = i === bins - 1 ? length : Math.min(length, start + samplesPerBin);
    let max = 0;
    for (let s = start; s < end; s++) {
      for (const ch of channels) {
        const v = Math.abs(ch[s]);
        if (v > max) max = v;
      }
    }
    out[i] = max;
  }
  let peak = 0;
  for (const v of out) if (v > peak) peak = v;
  if (peak > 0) {
    for (let i = 0; i < bins; i++) out[i] /= peak;
  }
  return out;
}

export function loadCachedPeaks(stemId: string): number[] | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + stemId);
    if (!raw) return null;
    const parts = raw.split(',');
    const out = new Array<number>(parts.length);
    for (let i = 0; i < parts.length; i++) {
      const n = parseInt(parts[i], 10);
      if (!isFinite(n)) return null;
      out[i] = Math.max(0, Math.min(1, n / 255));
    }
    return out;
  } catch {
    return null;
  }
}

export function saveCachedPeaks(stemId: string, peaks: number[]): void {
  try {
    const str = peaks
      .map((p) => Math.round(Math.max(0, Math.min(1, p)) * 255))
      .join(',');
    localStorage.setItem(CACHE_PREFIX + stemId, str);
  } catch {
    // localStorage may be unavailable or full — silently skip.
  }
}
