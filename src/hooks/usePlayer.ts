import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { LoadContext, LoadedStem, PlayerState, StemSource } from '../data/types';
import { PALETTE } from '../lib/colors';
import {
  loadVolume,
  saveVolume,
  shouldEndPlayback,
  shouldLoopWrap,
  stripCommonPrefix,
} from '../lib/audio';
import { fmt, longestStemIdx } from '../lib/format';

const DRIFT_THRESHOLD = 0.05;
const LOOP_TAIL = 0.005;
const END_TAIL = 0.02;

type Action =
  | { type: 'TEARDOWN' }
  | {
      type: 'LOADED';
      stems: LoadedStem[];
      duration: number;
      referenceIdx: number;
      practiceId: string | null;
      title: string;
      status: string;
    }
  | { type: 'SET_PLAYING'; isPlaying: boolean }
  | { type: 'SET_LOOP'; start: number | null; end: number | null }
  | { type: 'SET_LOOP_ENABLED'; enabled: boolean }
  | { type: 'TOGGLE_MUTE'; idx: number }
  | { type: 'TOGGLE_SOLO'; idx: number }
  | { type: 'SET_VOLUME'; idx: number; vol: number }
  | { type: 'FOCUS'; idx: number }
  | { type: 'SET_STATUS'; status: string };

const initialState: PlayerState = {
  practiceId: null,
  title: '—',
  stems: [],
  duration: 0,
  referenceIdx: 0,
  isPlaying: false,
  focusedIdx: -1,
  loop: null,
  status: '',
};

function reducer(state: PlayerState, action: Action): PlayerState {
  switch (action.type) {
    case 'TEARDOWN':
      return { ...initialState };
    case 'LOADED':
      return {
        ...state,
        practiceId: action.practiceId,
        title: action.title,
        stems: action.stems,
        duration: action.duration,
        referenceIdx: action.referenceIdx,
        isPlaying: false,
        focusedIdx: -1,
        loop: null,
        status: action.status,
      };
    case 'SET_PLAYING':
      return { ...state, isPlaying: action.isPlaying };
    case 'SET_LOOP':
      if (action.start == null || action.end == null) {
        return { ...state, loop: null };
      }
      return {
        ...state,
        loop: { start: action.start, end: action.end, enabled: state.loop?.enabled ?? true },
      };
    case 'SET_LOOP_ENABLED':
      if (!state.loop) return state;
      return { ...state, loop: { ...state.loop, enabled: action.enabled } };
    case 'TOGGLE_MUTE':
      return updateStem(state, action.idx, (s) => ({ ...s, userMuted: !s.userMuted }));
    case 'TOGGLE_SOLO':
      return updateStem(state, action.idx, (s) => ({ ...s, soloed: !s.soloed }));
    case 'SET_VOLUME':
      return updateStem(state, action.idx, (s) => ({ ...s, userVolume: action.vol }));
    case 'FOCUS':
      return { ...state, focusedIdx: action.idx };
    case 'SET_STATUS':
      return { ...state, status: action.status };
  }
}

function updateStem(state: PlayerState, idx: number, fn: (s: LoadedStem) => LoadedStem): PlayerState {
  if (idx < 0 || idx >= state.stems.length) return state;
  const next = state.stems.slice();
  next[idx] = fn(next[idx]);
  return { ...state, stems: next };
}

export type PlayerControls = {
  state: PlayerState;
  currentTime: number;
  load(input: { practiceId: string | null; title: string; sources: StemSource[] }): Promise<void>;
  togglePlay(): Promise<void>;
  pause(): void;
  seek(t: number): void;
  setVolume(idx: number, vol: number): void;
  toggleMute(idx: number): void;
  toggleSolo(idx: number): void;
  setLoop(start: number | null, end: number | null): void;
  setLoopEnabled(enabled: boolean): void;
  toggleLoopEnabled(): void;
  clearLoop(): void;
  focusStem(idx: number): void;
};

export function usePlayer(): PlayerControls {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [currentTime, setCurrentTime] = useState(0);

  // Refs that the rAF / interval callbacks read live, so they don't capture
  // stale state.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Last currentTime observed by the rAF tick. Used to gate the loop wrap so
  // it only fires when playback CROSSES loop.end, not when an explicit seek
  // jumps past it. Updated in seek() and after wraps too.
  const lastTRef = useRef(0);

  // ---- Mute/solo/volume side effects ----
  useEffect(() => {
    const anySolo = state.stems.some((s) => s.soloed);
    for (const s of state.stems) {
      const muted = anySolo ? !s.soloed : s.userMuted;
      s.audio.muted = muted;
      s.audio.volume = s.userVolume / 100;
    }
  }, [state.stems]);

  // ---- rAF: currentTime + loop wrap + end-of-song ----
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = stateRef.current;
      if (s.isPlaying && s.stems.length) {
        const ref = s.stems[s.referenceIdx]?.audio;
        if (ref) {
          const t = ref.currentTime;
          const prevT = lastTRef.current;
          setCurrentTime(t);
          if (shouldLoopWrap(t, prevT, s.loop, LOOP_TAIL)) {
            seekAll(s.stems, s.loop!.start);
            lastTRef.current = s.loop!.start;
            setCurrentTime(s.loop!.start);
          } else if (shouldEndPlayback(t, s.duration, END_TAIL)) {
            for (const stem of s.stems) stem.audio.pause();
            seekAll(s.stems, 0);
            lastTRef.current = 0;
            setCurrentTime(0);
            dispatch({ type: 'SET_PLAYING', isPlaying: false });
          } else {
            lastTRef.current = t;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- Drift correction: every 2s while playing ----
  useEffect(() => {
    if (!state.isPlaying) return;
    const id = setInterval(() => {
      const s = stateRef.current;
      if (!s.isPlaying || s.stems.length < 2) return;
      const refStem = s.stems[s.referenceIdx];
      if (!refStem) return;
      const ref = refStem.audio.currentTime;
      for (let i = 0; i < s.stems.length; i++) {
        if (i === s.referenceIdx) continue;
        const a = s.stems[i].audio;
        const cap = isFinite(a.duration) ? a.duration : Infinity;
        if (ref > cap) continue;
        if (Math.abs(a.currentTime - ref) > DRIFT_THRESHOLD) a.currentTime = ref;
      }
    }, 2000);
    return () => clearInterval(id);
  }, [state.isPlaying]);

  // ---- Cleanup on unmount: tear down audio elements ----
  useEffect(() => {
    return () => {
      const s = stateRef.current;
      for (const stem of s.stems) {
        try {
          stem.audio.pause();
          stem.revoke?.();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // ---- API ----
  const load = useCallback<PlayerControls['load']>(async (input) => {
    // Tear down current stems before building new ones.
    const prev = stateRef.current.stems;
    for (const s of prev) {
      try {
        s.audio.pause();
        s.revoke?.();
      } catch {
        // ignore
      }
    }
    lastTRef.current = 0;
    if (!input.sources.length) {
      dispatch({ type: 'TEARDOWN' });
      return;
    }
    const ctx: LoadContext = { practiceId: input.practiceId, title: input.title };
    dispatch({ type: 'SET_STATUS', status: `Loading ${input.sources.length} stem${input.sources.length === 1 ? '' : 's'}…` });

    const displayNames = stripCommonPrefix(input.sources.map((it) => it.name));
    const built: LoadedStem[] = input.sources.map((src, i) => {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = src.src;
      const userVolume = loadVolume(ctx.practiceId, src.name);
      audio.volume = userVolume / 100;
      return {
        name: src.name,
        displayName: displayNames[i],
        color: PALETTE[i % PALETTE.length],
        audio,
        userMuted: false,
        soloed: false,
        userVolume,
        practiceId: ctx.practiceId,
        revoke: src.revoke,
      };
    });

    const errored: string[] = [];
    await Promise.all(
      built.map(
        (s) =>
          new Promise<void>((res) => {
            if (s.audio.readyState >= 1) return res();
            s.audio.addEventListener('loadedmetadata', () => res(), { once: true });
            s.audio.addEventListener(
              'error',
              () => {
                errored.push(s.name);
                res();
              },
              { once: true },
            );
          }),
      ),
    );

    const durations = built.map((s) => s.audio.duration);
    const duration = durations.reduce((m, d) => Math.max(m, isFinite(d) ? d : 0), 0);
    const referenceIdx = longestStemIdx(durations);

    const okCount = built.length - errored.length;
    let status = `${okCount} stem${okCount === 1 ? '' : 's'} loaded`;
    if (duration) status += ` · ${fmt(duration)}`;
    if (errored.length) status += ` · failed: ${errored.join(', ')}`;

    dispatch({
      type: 'LOADED',
      stems: built,
      duration,
      referenceIdx,
      practiceId: input.practiceId,
      title: input.title,
      status,
    });
  }, []);

  const pause = useCallback(() => {
    for (const s of stateRef.current.stems) s.audio.pause();
    dispatch({ type: 'SET_PLAYING', isPlaying: false });
    // Mirror the dispatch into the ref so a re-entrant call within the same
    // tick (before React renders) sees the new isPlaying value.
    stateRef.current = { ...stateRef.current, isPlaying: false };
  }, []);

  const togglePlay = useCallback(async () => {
    const s = stateRef.current;
    if (!s.stems.length) return;
    if (s.isPlaying) {
      pause();
      return;
    }
    // Optimistic: set isPlaying immediately so the button reflects intent
    // and a re-entrant click sees the in-progress state and routes to pause
    // instead of starting a second play() round. Mirror into stateRef so the
    // same-tick re-entrant call sees the value before React renders.
    dispatch({ type: 'SET_PLAYING', isPlaying: true });
    stateRef.current = { ...stateRef.current, isPlaying: true };
    const refStem = s.stems[s.referenceIdx];
    const t = refStem?.audio.currentTime ?? 0;
    seekAll(s.stems, t);
    lastTRef.current = t;
    const results = await Promise.all(
      s.stems.map((stem) =>
        stem.audio.play().then(
          () => true,
          () => false,
        ),
      ),
    );
    // The user may have hit pause while we were awaiting play(). Honor that
    // intent: stop any audio elements that did manage to start.
    if (!stateRef.current.isPlaying) {
      for (const stem of s.stems) {
        try {
          stem.audio.pause();
        } catch {
          // ignore
        }
      }
      return;
    }
    if (results.every((ok) => !ok)) {
      dispatch({ type: 'SET_PLAYING', isPlaying: false });
      stateRef.current = { ...stateRef.current, isPlaying: false };
      dispatch({
        type: 'SET_STATUS',
        status: 'Playback blocked — click the page once and try again.',
      });
    }
  }, [pause]);

  const seek = useCallback((t: number) => {
    const s = stateRef.current;
    const clamped = Math.max(0, Math.min(s.duration, t));
    seekAll(s.stems, clamped);
    lastTRef.current = clamped;
    setCurrentTime(clamped);
  }, []);

  const setVolume = useCallback((idx: number, vol: number) => {
    const s = stateRef.current;
    const stem = s.stems[idx];
    if (!stem) return;
    saveVolume(stem.practiceId, stem.name, vol);
    dispatch({ type: 'SET_VOLUME', idx, vol });
  }, []);

  const toggleMute = useCallback((idx: number) => {
    dispatch({ type: 'TOGGLE_MUTE', idx });
  }, []);

  const toggleSolo = useCallback((idx: number) => {
    dispatch({ type: 'TOGGLE_SOLO', idx });
  }, []);

  const setLoop = useCallback((start: number | null, end: number | null) => {
    dispatch({ type: 'SET_LOOP', start, end });
  }, []);

  const setLoopEnabled = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_LOOP_ENABLED', enabled });
  }, []);

  const toggleLoopEnabled = useCallback(() => {
    const s = stateRef.current;
    if (!s.loop) return;
    dispatch({ type: 'SET_LOOP_ENABLED', enabled: !s.loop.enabled });
  }, []);

  const clearLoop = useCallback(() => {
    dispatch({ type: 'SET_LOOP', start: null, end: null });
  }, []);

  const focusStem = useCallback((idx: number) => {
    dispatch({ type: 'FOCUS', idx });
  }, []);

  return {
    state,
    currentTime,
    load,
    togglePlay,
    pause,
    seek,
    setVolume,
    toggleMute,
    toggleSolo,
    setLoop,
    setLoopEnabled,
    toggleLoopEnabled,
    clearLoop,
    focusStem,
  };
}

function seekAll(stems: LoadedStem[], t: number): void {
  for (const s of stems) {
    try {
      s.audio.currentTime = t;
    } catch {
      // ignore
    }
  }
}

