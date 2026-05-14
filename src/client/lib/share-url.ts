import type { PlayerState } from '../data/types';
import { DEFAULT_TRACK_H, MIN_HZOOM } from '../hooks/useViewport';

export type ShareMixEntry = {
  stemId: string;
  muted?: boolean;
  soloed?: boolean;
  volume?: number; // integer 0..200, undefined = at default (100)
};

/**
 * The visible time window on the timeline at share time. Encoded as the
 * start (`tl`) and end (`tr`) times in seconds rather than scrollLeft +
 * hZoom so recipients see the same time range regardless of screen size.
 */
export type ShareView = {
  timeLeft: number;
  timeRight: number;
};

export type ShareState = {
  projectId: string;
  time?: number; // seconds, 2-decimal precision in URL
  loop?: { start: number; end: number; enabled: boolean };
  masterVolume?: number; // integer 0..200, undefined = at default
  focusedCommentId?: string;
  mix?: ShareMixEntry[];
  /** Horizontal zoom + scroll, expressed as a visible time window. */
  view?: ShareView;
  /** Vertical zoom (track height in px). */
  trackHeight?: number;
};

export function encodeShareUrl(state: ShareState): string {
  const params: string[] = [];
  params.push(`p=${encodeURIComponent(state.projectId)}`);
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
  if (state.view) {
    params.push(`tl=${state.view.timeLeft.toFixed(2)}`);
    params.push(`tr=${state.view.timeRight.toFixed(2)}`);
  }
  if (state.trackHeight != null && state.trackHeight !== DEFAULT_TRACK_H) {
    params.push(`tz=${Math.round(state.trackHeight)}`);
  }
  return params.join('&');
}

export function decodeShareUrl(fragment: string): ShareState | null {
  if (!fragment) return null;
  const sp = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  const p = sp.get('p');
  if (!p) return null;
  const state: ShareState = { projectId: p };
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
  const tl = sp.get('tl');
  const tr = sp.get('tr');
  if (tl != null && tr != null) {
    const a = Number(tl);
    const b = Number(tr);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a && a >= 0) {
      state.view = { timeLeft: a, timeRight: b };
    }
  }
  const tz = sp.get('tz');
  if (tz != null) {
    const n = Number(tz);
    if (Number.isFinite(n) && n > 0) state.trackHeight = Math.round(n);
  }
  return state;
}

export type SnapshotViewport = {
  hZoom: number;
  trackHeight: number;
  scrollLeft: number;
  stageWidth: number;
  railWidth: number;
};

export type SnapshotInput = {
  projectId: string;
  player: PlayerState;
  currentTime: number;
  activeCommentId: string | null;
  viewport?: SnapshotViewport;
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
  const { projectId, player, currentTime, activeCommentId } = input;
  const state: ShareState = { projectId };
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

  if (input.viewport && player.duration > 0) {
    const v = input.viewport;
    const wave = Math.max(0, v.stageWidth * v.hZoom - v.railWidth);
    const waveVisible = Math.max(0, v.stageWidth - v.railWidth);
    if (v.hZoom > MIN_HZOOM && wave > 0) {
      const tl = (v.scrollLeft / wave) * player.duration;
      const tr = ((v.scrollLeft + waveVisible) / wave) * player.duration;
      const tlC = Math.max(0, Math.min(player.duration, tl));
      const trC = Math.max(tlC + 0.01, Math.min(player.duration, tr));
      state.view = { timeLeft: tlC, timeRight: trC };
    }
    if (v.trackHeight !== DEFAULT_TRACK_H) {
      state.trackHeight = v.trackHeight;
    }
  }

  return state;
}

/** Build a full share URL from a ShareState. */
export function buildShareUrl(state: ShareState, baseUrl: string): string {
  const base = baseUrl.replace(/#.*$/, '').replace(/\/$/, '');
  return `${base}/#${encodeShareUrl(state)}`;
}

/** Human-readable list of what's in the share state beyond project + time. */
export function describeShareCategories(
  state: ShareState,
): Array<'loop' | 'mix' | 'comment' | 'view'> {
  const cats: Array<'loop' | 'mix' | 'comment' | 'view'> = [];
  if (state.loop) cats.push('loop');
  if (state.mix && state.mix.length) cats.push('mix');
  if (state.focusedCommentId) cats.push('comment');
  if (state.view || state.trackHeight != null) cats.push('view');
  return cats;
}
