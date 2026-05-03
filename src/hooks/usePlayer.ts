import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type {
  LoadContext,
  LoadedStem,
  PlayerState,
  StemSource,
  WaveformNormalization,
} from '../data/types';
import { PALETTE } from '../lib/colors';
import {
  loadMasterVolume,
  loadVolume,
  loadWaveformNormalization,
  saveMasterVolume,
  saveVolume,
  saveWaveformNormalization,
  stripCommonPrefix,
  volumeToGain,
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
  | { type: 'SET_MASTER_VOLUME'; vol: number }
  | { type: 'FOCUS'; idx: number }
  | { type: 'SET_STATUS'; status: string }
  | { type: 'SET_WAVEFORM_NORM'; mode: WaveformNormalization };

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
  waveformNormalization: loadWaveformNormalization(),
  masterVolume: loadMasterVolume(),
};

function reducer(state: PlayerState, action: Action): PlayerState {
  switch (action.type) {
    case 'TEARDOWN':
      return {
        ...initialState,
        waveformNormalization: state.waveformNormalization,
        masterVolume: state.masterVolume,
      };
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
    case 'SET_MASTER_VOLUME':
      return { ...state, masterVolume: action.vol };
    case 'FOCUS':
      return { ...state, focusedIdx: action.idx };
    case 'SET_STATUS':
      return { ...state, status: action.status };
    case 'SET_WAVEFORM_NORM':
      return { ...state, waveformNormalization: action.mode };
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
  setMasterVolume(vol: number): void;
  toggleMute(idx: number): void;
  toggleSolo(idx: number): void;
  setLoop(start: number | null, end: number | null): void;
  setLoopEnabled(enabled: boolean): void;
  toggleLoopEnabled(): void;
  clearLoop(): void;
  focusStem(idx: number): void;
  setWaveformNormalization(mode: WaveformNormalization): void;
  toggleWaveformNormalization(): void;
};

export function usePlayer(): PlayerControls {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [currentTime, setCurrentTime] = useState(0);

  // Refs that the rAF / interval callbacks read live, so they don't capture
  // stale state.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Web Audio graph: a single AudioContext + master gain shared across loads.
  // Per-track GainNodes live on each LoadedStem.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);

  function ensureAudioGraph(): { ctx: AudioContext; master: GainNode } | null {
    if (audioCtxRef.current && masterGainRef.current) {
      return { ctx: audioCtxRef.current, master: masterGainRef.current };
    }
    const Ctor: typeof AudioContext | undefined =
      typeof window === 'undefined'
        ? undefined
        : window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = volumeToGain(stateRef.current.masterVolume);
      master.connect(ctx.destination);
      audioCtxRef.current = ctx;
      masterGainRef.current = master;
      return { ctx, master };
    } catch {
      return null;
    }
  }

  // ---- Mute/solo/volume side effects: drive per-track gain nodes. ----
  // When Web Audio wiring is unavailable, fall back to HTMLAudioElement.volume
  // (capped at 1.0 by the browser, so no boost — but at least everything stays
  // audible in environments where MediaElementSource isn't supported).
  useEffect(() => {
    const anySolo = state.stems.some((s) => s.soloed);
    for (const s of state.stems) {
      const muted = anySolo ? !s.soloed : s.userMuted;
      const trackGain = volumeToGain(s.userVolume);
      if (s.gain) {
        s.gain.gain.value = muted ? 0 : trackGain;
        s.audio.muted = false;
        s.audio.volume = 1;
      } else {
        s.audio.muted = muted;
        s.audio.volume = Math.min(1, trackGain);
      }
    }
  }, [state.stems]);

  // ---- Master volume side effect ----
  useEffect(() => {
    const master = masterGainRef.current;
    if (master) master.gain.value = volumeToGain(state.masterVolume);
  }, [state.masterVolume]);

  // ---- rAF: currentTime + loop wrap + end-of-song ----
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = stateRef.current;
      if (s.isPlaying && s.stems.length) {
        const ref = s.stems[s.referenceIdx]?.audio;
        if (ref) {
          const t = ref.currentTime;
          setCurrentTime(t);
          if (s.loop?.enabled && t >= s.loop.end - LOOP_TAIL) {
            seekAll(s.stems, s.loop.start);
            setCurrentTime(s.loop.start);
          } else if (s.duration && t >= s.duration - END_TAIL) {
            for (const stem of s.stems) stem.audio.pause();
            seekAll(s.stems, 0);
            setCurrentTime(0);
            dispatch({ type: 'SET_PLAYING', isPlaying: false });
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
          stem.gain?.disconnect();
          stem.revoke?.();
        } catch {
          // ignore
        }
      }
      try {
        masterGainRef.current?.disconnect();
        void audioCtxRef.current?.close();
      } catch {
        // ignore
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
        s.gain?.disconnect();
        s.revoke?.();
      } catch {
        // ignore
      }
    }
    if (!input.sources.length) {
      dispatch({ type: 'TEARDOWN' });
      return;
    }
    const ctx: LoadContext = { practiceId: input.practiceId, title: input.title };
    dispatch({ type: 'SET_STATUS', status: `Loading ${input.sources.length} stem${input.sources.length === 1 ? '' : 's'}…` });

    const displayNames = stripCommonPrefix(input.sources.map((it) => it.name));
    const graph = ensureAudioGraph();
    const built: LoadedStem[] = input.sources.map((src, i) => {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = src.src;
      const userVolume = loadVolume(ctx.practiceId, src.name);
      let gain: GainNode | null = null;
      if (graph) {
        try {
          const source = graph.ctx.createMediaElementSource(audio);
          gain = graph.ctx.createGain();
          gain.gain.value = volumeToGain(userVolume);
          source.connect(gain).connect(graph.master);
          audio.volume = 1;
        } catch {
          // MediaElementSource creation can fail (e.g. element already wired
          // somewhere). Fall through to native volume control.
          gain = null;
          audio.volume = Math.min(1, volumeToGain(userVolume));
        }
      } else {
        audio.volume = Math.min(1, volumeToGain(userVolume));
      }
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
        gain,
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
  }, []);

  const togglePlay = useCallback(async () => {
    const s = stateRef.current;
    if (!s.stems.length) return;
    if (s.isPlaying) {
      pause();
      return;
    }
    // Browsers start AudioContexts suspended until a user gesture; togglePlay
    // is always called from one, so this is the right place to resume.
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // ignore — playback will still attempt and surface its own error.
      }
    }
    const refStem = s.stems[s.referenceIdx];
    const t = refStem?.audio.currentTime ?? 0;
    seekAll(s.stems, t);
    const results = await Promise.all(
      s.stems.map((stem) =>
        stem.audio.play().then(
          () => true,
          () => false,
        ),
      ),
    );
    const successes = results.filter(Boolean).length;
    if (successes === 0) {
      dispatch({ type: 'SET_STATUS', status: 'Playback blocked — click the page once and try again.' });
      return;
    }
    dispatch({ type: 'SET_PLAYING', isPlaying: true });
  }, [pause]);

  const seek = useCallback((t: number) => {
    const s = stateRef.current;
    const clamped = Math.max(0, Math.min(s.duration, t));
    seekAll(s.stems, clamped);
    setCurrentTime(clamped);
  }, []);

  const setVolume = useCallback((idx: number, vol: number) => {
    const s = stateRef.current;
    const stem = s.stems[idx];
    if (!stem) return;
    saveVolume(stem.practiceId, stem.name, vol);
    dispatch({ type: 'SET_VOLUME', idx, vol });
  }, []);

  const setMasterVolume = useCallback((vol: number) => {
    saveMasterVolume(vol);
    dispatch({ type: 'SET_MASTER_VOLUME', vol });
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

  const setWaveformNormalization = useCallback((mode: WaveformNormalization) => {
    saveWaveformNormalization(mode);
    dispatch({ type: 'SET_WAVEFORM_NORM', mode });
  }, []);

  const toggleWaveformNormalization = useCallback(() => {
    const next: WaveformNormalization =
      stateRef.current.waveformNormalization === 'per-track' ? 'global' : 'per-track';
    saveWaveformNormalization(next);
    dispatch({ type: 'SET_WAVEFORM_NORM', mode: next });
  }, []);

  return {
    state,
    currentTime,
    load,
    togglePlay,
    pause,
    seek,
    setVolume,
    setMasterVolume,
    toggleMute,
    toggleSolo,
    setLoop,
    setLoopEnabled,
    toggleLoopEnabled,
    clearLoop,
    focusStem,
    setWaveformNormalization,
    toggleWaveformNormalization,
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

