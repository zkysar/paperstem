// Peaks: per-stem amplitude envelope. Two resolutions:
//   - PEAK_BINS (~110) for the picker thumbnail, cached in localStorage.
//   - PLAYER_PEAK_BINS (2000) for the main player waveform, stored server-side
//     on the `stems.peaks` column so WaveSurfer can render without decoding
//     the full audio.
// Wire format on the server side is comma-separated ints 0..255 — same as the
// localStorage cache. ~2000 bins ≈ 8KB per stem, manageable.

const CACHE_PREFIX = 'paperstem:peaks:v1:';
export const PEAK_BINS = 110;
export const PLAYER_PEAK_BINS = 2000;

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

// Wire-format encode/decode for the server-side `stems.peaks` column.
// Same format as the localStorage cache.
export function encodePeaks(peaks: number[]): string {
  return peaks
    .map((p) => Math.round(Math.max(0, Math.min(1, p)) * 255))
    .join(',');
}

export function decodePeaks(raw: string): number[] | null {
  if (!raw) return null;
  const parts = raw.split(',');
  if (parts.length === 0) return null;
  const out = new Array<number>(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const n = parseInt(parts[i], 10);
    if (!isFinite(n)) return null;
    out[i] = Math.max(0, Math.min(1, n / 255));
  }
  return out;
}
