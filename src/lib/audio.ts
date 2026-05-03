export const AUDIO_EXT = /\.(mp3|wav|ogg|oga|flac|m4a|aac|webm|opus)$/i;

// Slider range. 0 = silent, 100 = unity gain, 200 = +12 dB (4×).
export const VOLUME_MAX = 200;
export const VOLUME_UNITY = 100;
export const VOLUME_DEFAULT = 80;
export const MASTER_VOLUME_DEFAULT = 100;
const MASTER_VOLUME_KEY = 'vol:master';

// Strip the longest common prefix and the file extension from each name.
export function stripCommonPrefix(names: string[]): string[] {
  if (!names.length) return [];
  let prefix = names[0];
  for (const n of names) {
    while (n.indexOf(prefix) !== 0 && prefix.length) {
      prefix = prefix.slice(0, -1);
    }
    if (!prefix) break;
  }
  return names.map((n) =>
    n.slice(prefix.length).replace(/\.[^.]+$/, '').trim() || n.replace(/\.[^.]+$/, ''),
  );
}

// Map a slider value to a gain multiplier.
//   0..100   → 0.0 .. 1.0   (linear, unchanged below unity)
//   100..200 → 1.0 .. 4.0   (linear boost up to +12 dB)
// 100 is unity so the existing slider feel is preserved; the upper half is
// pure headroom for stems that need to be pushed.
export function volumeToGain(v: number): number {
  const clamped = Math.max(0, Math.min(VOLUME_MAX, v));
  if (clamped <= VOLUME_UNITY) return clamped / VOLUME_UNITY;
  return 1 + 3 * (clamped - VOLUME_UNITY) / VOLUME_UNITY;
}

export function loadVolume(practiceId: string | null, stemName: string): number {
  if (!practiceId) return VOLUME_DEFAULT;
  try {
    const v = localStorage.getItem(`vol:${practiceId}:${stemName}`);
    if (v == null) return VOLUME_DEFAULT;
    const parsed = parseInt(v, 10);
    return Math.max(0, Math.min(VOLUME_MAX, isFinite(parsed) ? parsed : VOLUME_DEFAULT));
  } catch {
    return VOLUME_DEFAULT;
  }
}

export function saveVolume(practiceId: string | null, stemName: string, v: number): void {
  if (!practiceId) return;
  try {
    localStorage.setItem(`vol:${practiceId}:${stemName}`, String(v));
  } catch {
    // localStorage unavailable (private mode, etc.) — silently skip.
  }
}

const WAVEFORM_NORM_KEY = 'paperstem:waveform-normalization';

export function loadWaveformNormalization(): 'per-track' | 'global' {
  try {
    const v = localStorage.getItem(WAVEFORM_NORM_KEY);
    return v === 'global' ? 'global' : 'per-track';
  } catch {
    return 'per-track';
  }
}

export function saveWaveformNormalization(mode: 'per-track' | 'global'): void {
  try {
    localStorage.setItem(WAVEFORM_NORM_KEY, mode);
  } catch {
    // ignore
  }
}

// Returns true only when the playhead just *crossed* loop.end during natural
// playback. A user-driven seek to anywhere outside the region updates prevT,
// so the next tick won't satisfy `prevT < loop.end - tail` and the wrap is
// suppressed — preventing the "seek-bounce-back" stuck-loop bug.
export function shouldLoopWrap(
  t: number,
  prevT: number,
  loop: { start: number; end: number; enabled: boolean } | null,
  tail: number,
): boolean {
  if (!loop || !loop.enabled) return false;
  const threshold = loop.end - tail;
  return t >= threshold && prevT < threshold;
}

export function shouldEndPlayback(t: number, duration: number, tail: number): boolean {
  return duration > 0 && t >= duration - tail;
}

export function loadMasterVolume(): number {
  try {
    const v = localStorage.getItem(MASTER_VOLUME_KEY);
    if (v == null) return MASTER_VOLUME_DEFAULT;
    const parsed = parseInt(v, 10);
    return Math.max(0, Math.min(VOLUME_MAX, isFinite(parsed) ? parsed : MASTER_VOLUME_DEFAULT));
  } catch {
    return MASTER_VOLUME_DEFAULT;
  }
}

export function saveMasterVolume(v: number): void {
  try {
    localStorage.setItem(MASTER_VOLUME_KEY, String(v));
  } catch {
    // ignore
  }
}
