import type { PlayerState } from '../data/types';

export type ShareMixEntry = {
  stemId: string;
  muted?: boolean;
  soloed?: boolean;
  volume?: number; // integer 0..200, undefined = at default (100)
};

export type ShareState = {
  practiceId: string;
  time?: number; // seconds, 2-decimal precision in URL
  loop?: { start: number; end: number; enabled: boolean };
  masterVolume?: number; // integer 0..200, undefined = at default
  focusedStemId?: string;
  focusedCommentId?: string;
  mix?: ShareMixEntry[];
};

export function encodeShareUrl(state: ShareState): string {
  const params: string[] = [];
  params.push(`p=${encodeURIComponent(state.practiceId)}`);
  if (state.time != null && state.time > 0) {
    params.push(`t=${state.time.toFixed(2)}`);
  }
  if (state.loop) {
    params.push(`l=${state.loop.start.toFixed(2)}-${state.loop.end.toFixed(2)}`);
    if (!state.loop.enabled) params.push('le=0');
  }
  if (state.masterVolume != null && state.masterVolume !== 100) {
    params.push(`mv=${state.masterVolume}`);
  }
  if (state.focusedStemId) {
    params.push(`fs=${encodeURIComponent(state.focusedStemId)}`);
  }
  if (state.focusedCommentId) {
    params.push(`fc=${encodeURIComponent(state.focusedCommentId)}`);
  }
  if (state.mix && state.mix.length > 0) {
    const parts = state.mix.map((e) => {
      let s = encodeURIComponent(e.stemId) + ':';
      if (e.muted) s += 'm';
      if (e.soloed) s += 's';
      if (e.volume != null && e.volume !== 100) s += `v${e.volume}`;
      return s;
    });
    params.push(`mix=${parts.join(',')}`);
  }
  return params.join('&');
}

export function decodeShareUrl(fragment: string): ShareState | null {
  if (!fragment) return null;
  const sp = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  const p = sp.get('p');
  if (!p) return null;
  const state: ShareState = { practiceId: p };
  const t = sp.get('t');
  if (t != null) {
    const n = Number(t);
    if (Number.isFinite(n) && n >= 0) state.time = n;
  }
  const l = sp.get('l');
  if (l) {
    const m = l.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/);
    if (m) {
      const start = Number(m[1]);
      const end = Number(m[2]);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start && start >= 0) {
        const enabled = sp.get('le') !== '0';
        state.loop = { start, end, enabled };
      }
    }
  }
  const mv = sp.get('mv');
  if (mv != null) {
    const n = Number(mv);
    if (Number.isFinite(n) && n >= 0 && n <= 200) state.masterVolume = Math.round(n);
  }
  const fs = sp.get('fs');
  if (fs) state.focusedStemId = fs;
  const fc = sp.get('fc');
  if (fc) state.focusedCommentId = fc;
  const mix = sp.get('mix');
  if (mix) {
    const entries: ShareMixEntry[] = [];
    for (const raw of mix.split(',')) {
      const colon = raw.indexOf(':');
      if (colon < 0) continue;
      const stemId = decodeURIComponent(raw.slice(0, colon));
      const flags = raw.slice(colon + 1);
      const entry: ShareMixEntry = { stemId };
      if (flags.includes('m')) entry.muted = true;
      if (flags.includes('s')) entry.soloed = true;
      const vMatch = flags.match(/v(\d+)/);
      if (vMatch) {
        const v = Number(vMatch[1]);
        if (Number.isFinite(v) && v >= 0 && v <= 200) entry.volume = v;
      }
      if (entry.muted || entry.soloed || entry.volume != null) entries.push(entry);
    }
    if (entries.length) state.mix = entries;
  }
  return state;
}

export type SnapshotInput = {
  practiceId: string;
  player: PlayerState;
  currentTime: number;
  activeCommentId: string | null;
};

export type SnapshotOverrides = {
  time?: number;
  focusedCommentId?: string;
};

/**
 * Build a ShareState from current player + UI state.
 * `overrides` is used by the "Copy link to this comment" flow to pin the
 * shared moment to a specific comment rather than the live playhead.
 */
export function snapshotShareState(
  input: SnapshotInput,
  overrides?: SnapshotOverrides,
): ShareState {
  const { practiceId, player, currentTime, activeCommentId } = input;
  const state: ShareState = { practiceId };
  const t = overrides?.time ?? currentTime;
  if (t > 0) state.time = t;
  if (player.loop) {
    state.loop = {
      start: player.loop.start,
      end: player.loop.end,
      enabled: player.loop.enabled,
    };
  }
  if (player.masterVolume !== 100) state.masterVolume = player.masterVolume;
  if (player.focusedIdx >= 0) {
    const focused = player.stems[player.focusedIdx];
    if (focused?.serverId) state.focusedStemId = focused.serverId;
  }
  const fc = overrides?.focusedCommentId ?? activeCommentId;
  if (fc) state.focusedCommentId = fc;

  const mix: ShareMixEntry[] = [];
  for (const stem of player.stems) {
    if (!stem.serverId) continue; // local-folder stems aren't shareable
    const entry: ShareMixEntry = { stemId: stem.serverId };
    if (stem.userMuted) entry.muted = true;
    if (stem.soloed) entry.soloed = true;
    if (stem.userVolume !== 100) entry.volume = stem.userVolume;
    if (entry.muted || entry.soloed || entry.volume != null) mix.push(entry);
  }
  if (mix.length) state.mix = mix;

  return state;
}

/** Build a full share URL from a ShareState. */
export function buildShareUrl(state: ShareState, baseUrl: string): string {
  const base = baseUrl.replace(/#.*$/, '').replace(/\/$/, '');
  return `${base}/#${encodeShareUrl(state)}`;
}

/** Human-readable list of what's in the share state beyond practice + time. */
export function describeShareCategories(
  state: ShareState,
): Array<'loop' | 'mix' | 'stem' | 'comment'> {
  const cats: Array<'loop' | 'mix' | 'stem' | 'comment'> = [];
  if (state.loop) cats.push('loop');
  if (state.mix && state.mix.length) cats.push('mix');
  if (state.focusedStemId) cats.push('stem');
  if (state.focusedCommentId) cats.push('comment');
  return cats;
}
