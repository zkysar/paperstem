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
      projectId: string | null;
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
  | { type: 'SET_STATUS'; status: string }
  | { type: 'SET_WAVEFORM_NORM'; mode: WaveformNormalization }
  | { type: 'SET_TITLE'; title: string }
  | { type: 'RENAME_STEM'; serverId: string; displayName: string }
  | { type: 'REMOVE_STEM'; serverId: string };

const initialState: PlayerState = {
  projectId: null,
  title: '—',
  driveFolderId: null,
  stems: [],
  duration: 0,
  referenceIdx: 0,
  isPlaying: false,
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
        projectId: action.projectId,
        title: action.title,
        driveFolderId: action.driveFolderId,
        stems: action.stems,
        duration: action.duration,
        referenceIdx: action.referenceIdx,
        isPlaying: false,
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
      // Reference idx needs to remain valid after removal.
      let referenceIdx = state.referenceIdx;
      if (referenceIdx === idx) {
        // Pick the longest remaining stem as the new reference; fall back to 0.
        referenceIdx = nextStems.length
          ? nextStems.reduce(
              (best, s, i, arr) =>
                stemDuration(s) > stemDuration(arr[best]) ? i : best,
              0,
            )
          : 0;
      } else if (referenceIdx > idx) {
        referenceIdx -= 1;
      }
      return { ...state, stems: nextStems, referenceIdx };
    }
  }
}

function stemDuration(s: LoadedStem): number {
  if (s.audioBuffer && isFinite(s.audioBuffer.duration)) return s.audioBuffer.duration;
  return isFinite(s.audio.duration) ? s.audio.duration : 0;
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
    projectId: string | null;
    title: string;
    driveFolderId: string | null;
    sources: StemSource[];
  }): Promise<void>;
  togglePlay(): void;
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

  // Web Audio scheduling refs.
  const sourcesRef = useRef<AudioBufferSourceNode[] | null>(null);
  const playStartCtxTimeRef = useRef(0);
  const playStartOffsetRef = useRef(0);
  const pausedOffsetRef = useRef(0);
  const isPlayingInternalRef = useRef(false);
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

  function computeCurrentTime(): number {
    if (!isPlayingInternalRef.current) return pausedOffsetRef.current;
    const ctx = audioCtxRef.current;
    if (!ctx) return pausedOffsetRef.current;
    const elapsed = ctx.currentTime - playStartCtxTimeRef.current;
    return playStartOffsetRef.current + Math.max(0, elapsed);
  }

  function stopSources(): void {
    const sources = sourcesRef.current;
    if (!sources) return;
    for (const src of sources) {
      try {
        src.onended = null;
        src.stop();
      } catch {
        // ignore — may already be stopped
      }
      try {
        src.disconnect();
      } catch {
        // ignore
      }
    }
    sourcesRef.current = null;
  }

  function startSourcesAt(offset: number): boolean {
    const ctx = audioCtxRef.current;
    if (!ctx) return false;
    const stems = stateRef.current.stems;
    const startWhen = ctx.currentTime + 0.05; // 50ms lookahead
    const sources: AudioBufferSourceNode[] = [];
    for (const stem of stems) {
      if (!stem.audioBuffer || !stem.gain) continue;
      const src = ctx.createBufferSource();
      src.buffer = stem.audioBuffer;
      src.connect(stem.gain);
      const clampedOffset = Math.min(offset, stem.audioBuffer.duration);
      if (clampedOffset >= stem.audioBuffer.duration) {
        // This stem is shorter than the seek target — skip; the rAF will treat
        // it as silent for the remainder.
        try {
          src.disconnect();
        } catch {
          // ignore
        }
        continue;
      }
      src.start(startWhen, clampedOffset);
      sources.push(src);
    }
    if (!sources.length) return false;
    sourcesRef.current = sources;
    playStartCtxTimeRef.current = startWhen;
    playStartOffsetRef.current = offset;
    return true;
  }

  // ---- Mute/solo/volume side effects: drive per-track gain nodes. ----
  useEffect(() => {
    const anySolo = state.stems.some((s) => s.soloed);
    for (const s of state.stems) {
      const muted = anySolo ? !s.soloed : s.userMuted;
      const trackGain = volumeToGain(s.userVolume);
      if (s.gain) {
        s.gain.gain.value = muted ? 0 : trackGain;
      }
      // HTMLAudioElement is permanently muted (set at load time); no per-update
      // adjustment needed.
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
      if (isPlayingInternalRef.current && s.stems.length) {
        const t = Math.min(s.duration, computeCurrentTime());
        const prevT = lastTRef.current;
        setCurrentTime(t);
        if (shouldLoopWrap(t, prevT, s.loop, LOOP_TAIL)) {
          // Internal seek (cheap — just reschedules sources).
          const target = s.loop!.start;
          pausedOffsetRef.current = target;
          lastTRef.current = target;
          setCurrentTime(target);
          stopSources();
          startSourcesAt(target);
        } else if (shouldEndPlayback(t, s.duration, END_TAIL)) {
          stopSources();
          pausedOffsetRef.current = 0;
          lastTRef.current = 0;
          setCurrentTime(0);
          isPlayingInternalRef.current = false;
          dispatch({ type: 'SET_PLAYING', isPlaying: false });
        } else {
          lastTRef.current = t;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- Cleanup on unmount: stop sources, disconnect gain nodes ----
  useEffect(() => {
    return () => {
      if (pendingSeekRafRef.current != null) {
        cancelAnimationFrame(pendingSeekRafRef.current);
        pendingSeekRafRef.current = null;
      }
      stopSources();
      const s = stateRef.current;
      for (const stem of s.stems) {
        try {
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
    stopSources();
    const prev = stateRef.current.stems;
    for (const s of prev) {
      try {
        s.gain?.disconnect();
        s.revoke?.();
      } catch {
        // ignore
      }
    }
    pausedOffsetRef.current = 0;
    lastTRef.current = 0;
    isPlayingInternalRef.current = false;
    if (!input.sources.length) {
      dispatch({ type: 'TEARDOWN' });
      return;
    }
    const ctx: LoadContext = { projectId: input.projectId, title: input.title };
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
      const userVolume = loadVolume(ctx.projectId, src.name);
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
        projectId: ctx.projectId,
        serverId: src.serverId ?? null,
        revoke: src.revoke,
        gain,
        peaks: src.peaks ?? null,
      };
    });

    const errored: string[] = [];

    // Decode each stem's audio into an AudioBuffer; that's the only thing we
    // need to play (and gives us a duration). The HTMLAudioElement is bound for
    // WaveSurfer but we intentionally don't wait on its `loadedmetadata` — on
    // mobile Safari, a muted <audio> with preload="auto" often doesn't fire
    // that event until a play() inside a user gesture, which would hang load()
    // forever.
    await Promise.all(
      built.map(async (s, i) => {
        const buf = await decodeStem(graph.ctx, input.sources[i].src);
        if (buf) {
          // Mutate in place — the array is local and not yet in state.
          built[i].audioBuffer = buf;
        } else {
          errored.push(s.name);
        }
        dispatch({ type: 'LOAD_PROGRESS' });
      }),
    );

    const durations = built.map((s) => stemDuration(s));
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
      projectId: input.projectId,
      title: input.title,
      driveFolderId: input.driveFolderId,
      status,
    });
  }, []);

  const pause = useCallback(() => {
    if (isPlayingInternalRef.current) {
      pausedOffsetRef.current = Math.min(
        stateRef.current.duration,
        computeCurrentTime(),
      );
    }
    stopSources();
    dispatch({ type: 'SET_PLAYING', isPlaying: false });
    stateRef.current = { ...stateRef.current, isPlaying: false };
    isPlayingInternalRef.current = false;
  }, []);

  const togglePlay = useCallback(() => {
    const s = stateRef.current;
    if (!s.stems.length) return;
    if (s.isPlaying) {
      pause();
      return;
    }
    // iOS Safari only unlocks the audio session when the gesture handler
    // schedules audio synchronously. Awaiting ctx.resume() consumes the
    // user-activation token before we get to startSourcesAt, leaving the
    // context "running" but the speaker silent until some other tap on the
    // device unlocks it. So: fire resume without awaiting, and play a
    // one-sample silent buffer in the same gesture to force the unlock.
    const ctx = audioCtxRef.current;
    if (ctx) {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {
          // ignore — startSourcesAt will surface failure
        });
      }
      try {
        const silent = ctx.createBuffer(1, 1, 22050);
        const unlock = ctx.createBufferSource();
        unlock.buffer = silent;
        unlock.connect(ctx.destination);
        unlock.start(0);
      } catch {
        // ignore — the real sources below are what matter
      }
    }
    dispatch({ type: 'SET_PLAYING', isPlaying: true });
    stateRef.current = { ...stateRef.current, isPlaying: true };
    isPlayingInternalRef.current = true;
    const offset = pausedOffsetRef.current;
    const ok = startSourcesAt(offset);
    if (!ok) {
      dispatch({ type: 'SET_PLAYING', isPlaying: false });
      stateRef.current = { ...stateRef.current, isPlaying: false };
      isPlayingInternalRef.current = false;
      dispatch({
        type: 'SET_STATUS',
        status: 'Playback blocked — click the page once and try again.',
      });
    }
  }, [pause]);

  // Coalesce rapid seeks (e.g. spam-clicking the timeline) into one audio
  // reschedule per frame. The visual cursor still moves on every call so the
  // UI feels responsive; only the (expensive) stopSources/startSourcesAt pair
  // is deferred, and only the latest target survives.
  const pendingSeekTargetRef = useRef<number | null>(null);
  const pendingSeekRafRef = useRef<number | null>(null);

  const seek = useCallback((t: number) => {
    const s = stateRef.current;
    const clamped = Math.max(0, Math.min(s.duration, t));
    pausedOffsetRef.current = clamped;
    lastTRef.current = clamped;
    setCurrentTime(clamped);
    if (!isPlayingInternalRef.current) {
      // Paused: nothing scheduled, no need to coalesce.
      return;
    }
    pendingSeekTargetRef.current = clamped;
    if (pendingSeekRafRef.current != null) return;
    pendingSeekRafRef.current = requestAnimationFrame(() => {
      pendingSeekRafRef.current = null;
      const target = pendingSeekTargetRef.current;
      pendingSeekTargetRef.current = null;
      if (target == null) return;
      if (!isPlayingInternalRef.current) return;
      stopSources();
      startSourcesAt(target);
    });
  }, []);

  const setVolume = useCallback((idx: number, vol: number) => {
    const s = stateRef.current;
    const stem = s.stems[idx];
    if (!stem) return;
    saveVolume(stem.projectId, stem.name, vol);
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
    const wasPlaying = isPlayingInternalRef.current;
    const at = computeCurrentTime();
    const stem = stateRef.current.stems.find((s) => s.serverId === serverId);
    if (stem) {
      try {
        stem.gain?.disconnect();
        stem.revoke?.();
      } catch {
        // ignore
      }
    }
    stopSources();
    dispatch({ type: 'REMOVE_STEM', serverId });
    // Reschedule remaining stems so the removed source actually stops.
    if (wasPlaying) {
      // Defer to next tick so the dispatch has been applied to stateRef.
      queueMicrotask(() => {
        startSourcesAt(at);
      });
    }
  }, []);

  const clear = useCallback(() => {
    // Tear down any in-flight stems (stop sources, disconnect gain nodes,
    // revoke object URLs) before discarding them. Mirrors the cleanup load()
    // does at the top of its body so the player can return to its empty state
    // without leaking resources.
    stopSources();
    const prev = stateRef.current.stems;
    for (const s of prev) {
      try {
        s.gain?.disconnect();
        s.revoke?.();
      } catch {
        // ignore
      }
    }
    pausedOffsetRef.current = 0;
    lastTRef.current = 0;
    isPlayingInternalRef.current = false;
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
    setWaveformNormalization,
    toggleWaveformNormalization,
    setTitle,
    renameStem,
    removeStem,
    clear,
  };
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

