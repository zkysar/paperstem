export const AUDIO_EXT = /\.(mp3|wav|ogg|oga|flac|m4a|aac|webm|opus)$/i;

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

export function loadVolume(practiceId: string | null, stemName: string): number {
  if (!practiceId) return 80;
  try {
    const v = localStorage.getItem(`vol:${practiceId}:${stemName}`);
    if (v == null) return 80;
    const parsed = parseInt(v, 10);
    return Math.max(0, Math.min(100, isFinite(parsed) ? parsed : 80));
  } catch {
    return 80;
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
