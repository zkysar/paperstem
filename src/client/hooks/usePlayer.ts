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
  shouldEndPlayback,
  shouldLoopWrap,
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
      type: 'LOAD_START';
      displayNames: string[];
      colors: string[];
      status: string;
    }
  | { type: 'LOAD_PROGRESS' }
  | {
      type: 'LOADED';
      stems: LoadedStem[];
      duration: number;
      referenceIdx: number;
      practiceId: string | null;
      title: string;
      driveFolderId: string | null;
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
  | { type: 'SET_WAVEFORM_NORM'; mode: WaveformNormalization }
  | { type: 'SET_TITLE'; title: string }
  | { type: 'RENAME_STEM'; serverId: string; displayName: string }
  | { type: 'REMOVE_STEM'; serverId: string };

const initialState: PlayerState = {
  practiceId: null,
  title: '—',
  driveFolderId: null,
  stems: [],
  duration: 0,
  referenceIdx: 0,
  isPlaying: false,
  focusedIdx: -1,
  loop: null,
  status: '',
  loading: null,
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
    case 'LOAD_START':
      return {
        ...state,
        stems: [],
        duration: 0,
        referenceIdx: 0,
        isPlaying: false,
        focusedIdx: -1,
        loop: null,
        status: action.status,
        loading: {
          displayNames: action.displayNames,
          colors: action.colors,
          loaded: 0,
        },
      };
    case 'LOAD_PROGRESS': {
      if (!state.loading) return state;
      const next = Math.min(state.loading.loaded + 1, state.loading.displayNames.length);
      return { ...state, loading: { ...state.loading, loaded: next } };
    }
    case 'LOADED':
      return {
        ...state,
        practiceId: action.practiceId,
        title: action.title,
        driveFolderId: action.driveFolderId,
        stems: action.stems,
        duration: action.duration,
        referenceIdx: action.referenceIdx,
        isPlaying: false,
        focusedIdx: -1,
        loop: null,
        status: action.status,
        loading: null,
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
    case 'SET_TITLE':
      return { ...state, title: action.title };
    case 'RENAME_STEM': {
      const idx = state.stems.findIndex((s) => s.serverId === action.serverId);
      if (idx < 0) return state;
      return updateStem(state, idx, (s) => ({ ...s, displayName: action.displayName }));
    }
    case 'REMOVE_STEM': {
      const idx = state.stems.findIndex((s) => s.serverId === action.serverId);
      if (idx < 0) return state;
      const nextStems = state.stems.slice();
      nextStems.splice(idx, 1);
      // Reference idx and focused idx need to remain valid after removal.
      let referenceIdx = state.referenceIdx;
      if (referenceIdx === idx) {
        // Pick the longest remaining stem as the new reference; fall back to 0.
        referenceIdx = nextStems.length
          ? nextStems.reduce(
              (best, s, i, arr) =>
                (isFinite(s.audio.duration) ? s.audio.duration : 0) >
                (isFinite(arr[best].audio.duration) ? arr[best].audio.duration : 0)
                  ? i
                  : best,
              0,
            )
          : 0;
      } else if (referenceIdx > idx) {
        referenceIdx -= 1;
      }
      let focusedIdx = state.focusedIdx;
      if (focusedIdx === idx) focusedIdx = -1;
      else if (focusedIdx > idx) focusedIdx -= 1;
      return { ...state, stems: nextStems, referenceIdx, focusedIdx };
    }
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
  load(input: {
    practiceId: string | null;
    title: string;
    driveFolderId: string | null;
    sources: StemSource[];
  }): Promise<void>;
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
  setTitle(title: string): void;
  renameStem(serverId: string, displayName: string): void;
  removeStem(serverId: string): void;
  clear(): void;
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
    lastTRef.current = 0;
    if (!input.sources.length) {
      dispatch({ type: 'TEARDOWN' });
      return;
    }
    const ctx: LoadContext = { practiceId: input.practiceId, title: input.title };
    const displayNames = stripCommonPrefix(input.sources.map((it) => it.name));
    const colors = input.sources.map((_, i) => PALETTE[i % PALETTE.length]);
    dispatch({
      type: 'LOAD_START',
      displayNames,
      colors,
      status: `Loading ${input.sources.length} stem${input.sources.length === 1 ? '' : 's'}…`,
    });

    const graph = ensureAudioGraph();
    if (!graph) {
      // Web Audio is required for synchronized playback. Surface this as a load
      // failure rather than silently falling back to broken multi-track sync.
      dispatch({
        type: 'SET_STATUS',
        status: 'This browser does not support Web Audio. Try Chrome or Safari.',
      });
      return;
    }
    const built: LoadedStem[] = input.sources.map((src, i) => {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.muted = true; // Web Audio drives all sound now; this is metadata only.
      audio.src = src.src;
      const userVolume = loadVolume(ctx.practiceId, src.name);
      const gain = graph.ctx.createGain();
      gain.gain.value = volumeToGain(userVolume);
      gain.connect(graph.master);
      return {
        name: src.name,
        displayName: displayNames[i],
        color: PALETTE[i % PALETTE.length],
        audio,
        audioBuffer: null, // Populated after decode below.
        userMuted: false,
        soloed: false,
        userVolume,
        practiceId: ctx.practiceId,
        serverId: src.serverId ?? null,
        revoke: src.revoke,
        gain,
        peaks: src.peaks ?? null,
      };
    });

    const errored: string[] = [];

    // Parallel: wait for HTMLAudioElement metadata (for duration/WaveSurfer) AND
    // for AudioBuffer decode (for playback). Each stem reports load-progress once
    // both complete (or either errors).
    await Promise.all(
      built.map(async (s, i) => {
        const metaP = new Promise<void>((res) => {
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
        });
        const decodeP = decodeStem(graph.ctx, input.sources[i].src).then((buf) => {
          if (buf) {
            // Mutate in place — the array is local and not yet in state.
            built[i].audioBuffer = buf;
          } else if (!errored.includes(s.name)) {
            errored.push(s.name);
          }
        });
        await Promise.all([metaP, decodeP]);
        dispatch({ type: 'LOAD_PROGRESS' });
      }),
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
      driveFolderId: input.driveFolderId,
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

  const setTitle = useCallback((title: string) => {
    dispatch({ type: 'SET_TITLE', title });
  }, []);

  const renameStem = useCallback((serverId: string, displayName: string) => {
    dispatch({ type: 'RENAME_STEM', serverId, displayName });
  }, []);

  const removeStem = useCallback((serverId: string) => {
    // Tear down the audio element / gain / object URL before dropping it from
    // state — otherwise the audio keeps playing and the URL leaks.
    const stem = stateRef.current.stems.find((s) => s.serverId === serverId);
    if (stem) {
      try {
        stem.audio.pause();
        stem.gain?.disconnect();
        stem.revoke?.();
      } catch {
        // ignore
      }
    }
    dispatch({ type: 'REMOVE_STEM', serverId });
  }, []);

  const clear = useCallback(() => {
    // Tear down any in-flight stems (pause audio elements, disconnect gain
    // nodes, revoke object URLs) before discarding them. Mirrors the cleanup
    // load() does at the top of its body so the player can return to its
    // empty state without leaking resources.
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
    lastTRef.current = 0;
    setCurrentTime(0);
    dispatch({ type: 'TEARDOWN' });
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
    setTitle,
    renameStem,
    removeStem,
    clear,
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

async function decodeStem(
  ctx: AudioContext,
  url: string,
): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return await ctx.decodeAudioData(buf);
  } catch {
    return null;
  }
}

