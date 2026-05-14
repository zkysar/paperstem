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
import { isIOS } from '../lib/platform';

const LOOP_TAIL = 0.005;
const END_TAIL = 0.02;

// Probe audio used to detect when iOS Focus / Do Not Disturb is suppressing
// playback. Under DND, HTMLAudioElement.play() returns a promise that never
// resolves — it just hangs in HAVE_NOTHING. Under normal conditions a
// ~2KB same-origin MP3 .play() resolves in well under a second. We race
// the promise against a timeout to decide whether to show a UX warning.
const SILENT_AUDIO_URL = '/silent.mp3';
const DND_PROBE_TIMEOUT_MS = 1500;

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
      folderId: string | null;
      status: string;
    }
  | { type: 'SET_PLAYING'; isPlaying: boolean }
  | { type: 'SET_LOOP'; start: number | null; end: number | null }
  | { type: 'SET_LOOP_ENABLED'; enabled: boolean }
  | { type: 'SET_LOOP_ARMED'; armed: boolean }
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
  folderId: null,
  stems: [],
  duration: 0,
  referenceIdx: 0,
  isPlaying: false,
  loop: null,
  loopArmed: false,
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
        loopArmed: false,
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
        folderId: action.folderId,
        stems: action.stems,
        duration: action.duration,
        referenceIdx: action.referenceIdx,
        isPlaying: false,
        loop: null,
        loopArmed: false,
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
        // Creating/replacing a region disarms — armed is the pre-region
        // "looping is on, waiting for a drag" state, not a flag that
        // outlives the drag.
        loop: { start: action.start, end: action.end, enabled: state.loop?.enabled ?? true },
        loopArmed: false,
      };
    case 'SET_LOOP_ENABLED':
      if (!state.loop) return state;
      return { ...state, loop: { ...state.loop, enabled: action.enabled } };
    case 'SET_LOOP_ARMED':
      return { ...state, loopArmed: action.armed };
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
  debugInfo: string;
  audioSuppressed: boolean;
  load(input: {
    projectId: string | null;
    title: string;
    folderId: string | null;
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
  // iOS DND / Focus detection. Set to true when the /silent.mp3 probe
  // .play() promise hasn't resolved within DND_PROBE_TIMEOUT_MS — the
  // observed signature of Focus/DND-suppressed audio. UI surfaces a
  // banner. Resets to false when a subsequent probe resolves (user
  // disabled DND and tapped play again).
  const [audioSuppressed, setAudioSuppressed] = useState(false);
  // Dev-only diagnostic surfaced in the avatar dropdown — visible local
  // and on paperstem-dev, hidden in prod via AppHeader's appEnv check.
  const [debugInfo, setDebugInfo] = useState('');

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

  // Generation counter for DND probes. Each togglePlay starts a fresh probe;
  // older probes' callbacks no-op so a fast tap-tap doesn't flap the banner.
  const dndProbeGenRef = useRef(0);

  // Throttle MediaSession.setPositionState — the lock-screen scrubber only
  // needs a few updates per second, and the call goes through a structured
  // clone on every invocation.
  const lastPositionUpdateRef = useRef(0);

  // Refs to the latest play/pause/seek callbacks, read by the MediaSession
  // action handlers registered once on mount. Avoids re-registering handlers
  // on every render and keeps them pointed at fresh closures.
  const togglePlayRef = useRef<() => void>(() => {});
  const pauseRef = useRef<() => void>(() => {});
  const seekRef = useRef<(t: number) => void>(() => {});

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
        const now = performance.now();
        if (now - lastPositionUpdateRef.current > 250) {
          lastPositionUpdateRef.current = now;
          updateMediaSessionPosition(t, s.duration);
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

  // ---- MediaSession: lock-screen / Now Playing controls ----
  // Web Audio playback alone doesn't anchor iOS Now Playing; the player's
  // HTMLAudioElement is permanently muted (Web Audio drives sound). Setting
  // mediaSession metadata + action handlers is what surfaces the widget.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    const ms = navigator.mediaSession;
    const setHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // Browser doesn't support this action — fine.
      }
    };
    setHandler('play', () => togglePlayRef.current());
    setHandler('pause', () => pauseRef.current());
    setHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') seekRef.current(details.seekTime);
    });
    setHandler('seekbackward', (details) => {
      const step = details.seekOffset ?? 10;
      const cur = isPlayingInternalRef.current
        ? computeCurrentTime()
        : pausedOffsetRef.current;
      seekRef.current(Math.max(0, cur - step));
    });
    setHandler('seekforward', (details) => {
      const step = details.seekOffset ?? 10;
      const cur = isPlayingInternalRef.current
        ? computeCurrentTime()
        : pausedOffsetRef.current;
      seekRef.current(Math.min(stateRef.current.duration, cur + step));
    });
    return () => {
      setHandler('play', null);
      setHandler('pause', null);
      setHandler('seekto', null);
      setHandler('seekbackward', null);
      setHandler('seekforward', null);
      try {
        ms.metadata = null;
        ms.playbackState = 'none';
      } catch {
        // ignore
      }
    };
  }, []);

  // Keep MediaSession metadata in sync with the loaded project.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    const ms = navigator.mediaSession;
    if (!state.stems.length) {
      try {
        ms.metadata = null;
        ms.playbackState = 'none';
      } catch {
        // ignore
      }
      return;
    }
    try {
      ms.metadata = new MediaMetadata({
        title: state.title && state.title !== '—' ? state.title : 'Untitled',
        artist: 'Paperstem',
        artwork: [{ src: '/favicon.svg', sizes: '64x64', type: 'image/svg+xml' }],
      });
    } catch {
      // MediaMetadata constructor can throw on artwork validation in some
      // browsers; the player still functions without metadata.
    }
  }, [state.stems.length, state.title]);

  // Drive MediaSession.playbackState from the player's isPlaying state so the
  // lock-screen widget shows the right play/pause icon.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    if (!state.stems.length) return;
    try {
      navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
    } catch {
      // ignore
    }
  }, [state.isPlaying, state.stems.length]);

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
      folderId: input.folderId,
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
    updateMediaSessionPosition(pausedOffsetRef.current, stateRef.current.duration);
  }, []);

  const togglePlay = useCallback(() => {
    const s = stateRef.current;
    if (!s.stems.length) return;
    if (s.isPlaying) {
      pause();
      return;
    }
    // iOS has a non-standard 'interrupted' AudioContext state in addition
    // to 'suspended' (entered on tab switch, screen lock, headphones
    // unplug, calls). Resume on anything that isn't running. Fire and
    // forget — awaiting here would consume the user-activation token and
    // break iOS gesture chaining.
    const ctx = audioCtxRef.current;
    const preState: string = ctx?.state ?? 'no-ctx';
    let resumePromise: Promise<void> | null = null;
    if (ctx && ctx.state !== 'running') {
      resumePromise = ctx.resume();
    }
    dispatch({ type: 'SET_PLAYING', isPlaying: true });
    stateRef.current = { ...stateRef.current, isPlaying: true };
    isPlayingInternalRef.current = true;
    const offset = pausedOffsetRef.current;
    const ok = startSourcesAt(offset);
    updateMediaSessionPosition(offset, stateRef.current.duration);
    if (!ok) {
      dispatch({ type: 'SET_PLAYING', isPlaying: false });
      stateRef.current = { ...stateRef.current, isPlaying: false };
      isPlayingInternalRef.current = false;
      dispatch({
        type: 'SET_STATUS',
        status: 'Playback blocked — click the page once and try again.',
      });
      return;
    }
    // DND / Focus probe: under iOS Focus modes that suppress media, an
    // HTMLAudio.play() promise on a small same-origin source never
    // settles (the element hangs in HAVE_NOTHING). Under normal
    // conditions it resolves in well under a second. Race it against a
    // timeout to drive the audio-suppressed banner. iOS-only — macOS
    // Safari can momentarily stall the same probe with no user-visible
    // suppression, which would produce false-positive banners.
    const myGen = ++dndProbeGenRef.current;
    const probeAudio = isIOS() ? new Audio(SILENT_AUDIO_URL) : null;
    if (probeAudio) probeAudio.volume = 0;
    const probePromise = probeAudio?.play() ?? null;
    let probeSettled = !probeAudio;
    void probePromise
      ?.then(() => {
        probeSettled = true;
        if (myGen !== dndProbeGenRef.current) return;
        setAudioSuppressed(false);
      })
      .catch(() => {
        // Autoplay rejection is fine — we know audio is permitted at this
        // point because real Web Audio sources were just scheduled in the
        // same gesture. Leave audioSuppressed as it was.
        probeSettled = true;
      });
    if (probeAudio) {
      window.setTimeout(() => {
        if (myGen !== dndProbeGenRef.current) return;
        if (!probeSettled) setAudioSuppressed(true);
      }, DND_PROBE_TIMEOUT_MS);
    }
    // Dev diagnostic — gated to dev environments at the render site.
    const stems = stateRef.current.stems;
    const decodedCount = stems.filter((stem) => stem.audioBuffer != null).length;
    const srcCount = sourcesRef.current?.length ?? 0;
    const status = {
      postState: preState,
      resumeResult: resumePromise ? 'pending' : 'skip',
      probe: 'pending',
    };
    const render = (): void => {
      setDebugInfo(
        `play · ctx:${preState}→${status.postState} · resume:${status.resumeResult} · bufs:${decodedCount}/${stems.length} · srcs:${srcCount} · probe:${status.probe}`,
      );
    };
    render();
    if (resumePromise) {
      resumePromise
        .then(() => {
          status.resumeResult = 'ok';
          if (ctx) status.postState = ctx.state;
          render();
        })
        .catch((err: unknown) => {
          status.resumeResult = `rej(${(err as Error)?.name ?? 'err'})`;
          if (ctx) status.postState = ctx.state;
          render();
        });
    }
    void probePromise
      ?.then(() => {
        status.probe = 'ok';
        render();
      })
      .catch((err: unknown) => {
        status.probe = `rej(${(err as Error)?.name ?? 'err'})`;
        render();
      });
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
    updateMediaSessionPosition(clamped, s.duration);
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
    if (!s.loop) {
      // No region yet — toggling the loop button arms the next ruler drag
      // to create one. Click again to disarm without creating anything.
      dispatch({ type: 'SET_LOOP_ARMED', armed: !s.loopArmed });
      return;
    }
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

  // Point MediaSession action-handler refs at the latest callbacks. These
  // refs are read by handlers registered once on mount, so handlers never
  // capture stale closures.
  togglePlayRef.current = togglePlay;
  pauseRef.current = pause;
  seekRef.current = seek;

  return {
    state,
    currentTime,
    debugInfo,
    audioSuppressed,
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

function updateMediaSessionPosition(position: number, duration: number): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  if (typeof ms.setPositionState !== 'function') return;
  if (!isFinite(duration) || duration <= 0) return;
  try {
    ms.setPositionState({
      duration,
      playbackRate: 1,
      position: Math.max(0, Math.min(position, duration)),
    });
  } catch {
    // setPositionState throws if position > duration on some engines; we
    // clamp above but iOS has rounded edge cases. Ignore.
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

