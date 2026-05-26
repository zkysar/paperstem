import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type {
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
import { isAndroid, isIOS } from '../lib/platform';
import { isMp3 } from '../lib/mp3-frames';
import {
  DEFAULT_SEGMENT_SEC,
  decodeSegment,
  fetchSegmentBytes,
  planSegments,
  type PlannedSegment,
} from '../lib/segment-stream';
import { computeSegmentSchedule } from '../lib/segment-scheduler';
import { sessionTimings, type SegTiming } from '../lib/segment-runs';

const SEGMENT_SEC = DEFAULT_SEGMENT_SEC;

const LOOP_TAIL = 0.005;
const END_TAIL = 0.02;

// First Range probe size. Large enough to cover an ID3 tag plus the whole first
// ~20s segment of our 64 kbps re-encodes (~160 KB), so segment 0 usually
// decodes from the probe bytes with no second fetch.
const PROBE_BYTES = 256 * 1024;

// Decoded segment keyed by plan index. startSec/endSec are NOT stored — they
// are derived per play session from the session anchor (see segment-runs).
type DecodedSeg = { buffer: AudioBuffer; duration: number };
// Per-stem segment store: the stem's live gain node, its decoded segments keyed
// by plan index, and the set of plan indices whose fetch/decode failed.
type StemSegments = { gain: GainNode; segments: Map<number, DecodedSeg>; errored: Set<number> };

// segmentsRef key: serverId when present, else a positional fallback so
// local-folder loads (no serverId) still get a stable per-stem key.
const stemKey = (serverId: string | null, idx: number): string =>
  serverId ?? `idx:${idx}`;

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
      // Stems are built and dispatched up front (audioBuffer still null) so the
      // waveform, sections, comments, and timeline render from precomputed
      // peaks + known duration immediately. Audio bytes download/decode in the
      // background and land via HEADS_READY.
      type: 'LOAD_START';
      stems: LoadedStem[];
      projectId: string | null;
      title: string;
      folderId: string | null;
      total: number;
      status: string;
    }
  | { type: 'LOAD_PROGRESS'; delta: number }
  | { type: 'NUDGE_LOADING' }
  | {
      // Every stem's HEAD is ready (MP3 stems have segment 0 decoded into
      // segmentsRef; non-MP3 stems have their full audioBuffer here). Merges
      // the non-MP3 buffers into the current stems and clears `loading` so
      // togglePlay is unblocked — playback hasn't started yet, so resetting
      // isPlaying/loop is safe. The remaining MP3 segments fill in the
      // background after this.
      type: 'HEADS_READY';
      buffers: Array<{ serverId: string | null; buffer: AudioBuffer | null }>;
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
  // Reconcile duration/referenceIdx from the summed actual decoded segment
  // durations once the background fill completes. Touches ONLY duration +
  // referenceIdx — never transport state (isPlaying/loop/loopArmed/status) or
  // stems — because playback may already be running when it fires.
  | { type: 'SET_DURATION'; duration: number; referenceIdx: number }
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
    case 'LOAD_START': {
      const { duration, referenceIdx } = durationAndReference(action.stems);
      return {
        ...state,
        projectId: action.projectId,
        title: action.title,
        folderId: action.folderId,
        stems: action.stems,
        duration,
        referenceIdx,
        isPlaying: false,
        loop: null,
        loopArmed: false,
        status: action.status,
        loading: { total: action.total, loaded: 0, nudge: 0 },
      };
    }
    case 'LOAD_PROGRESS': {
      if (!state.loading) return state;
      const next = Math.min(state.loading.loaded + action.delta, state.loading.total);
      return { ...state, loading: { ...state.loading, loaded: next } };
    }
    case 'NUDGE_LOADING': {
      // A play attempt arrived while audio was still loading. Bump the counter
      // so the loading indicator can flash and announce — no playback change.
      if (!state.loading) return state;
      return { ...state, loading: { ...state.loading, nudge: state.loading.nudge + 1 } };
    }
    case 'HEADS_READY': {
      // Merge decoded buffers into the CURRENT stems (matched by serverId, or
      // index for local-folder loads), so any mute/solo/volume the user set
      // while audio was downloading survives. Replacing the array wholesale
      // would revert those. HEADS_READY carries only non-MP3 (full-file) stems'
      // buffers; MP3 stems play from segmentsRef and keep audioBuffer null, so
      // their `buffer: null` entries leave the stem's existing buffer alone.
      const stems = mergeBuffers(state.stems, action.buffers);
      const { duration, referenceIdx } = durationAndReference(stems);
      return {
        ...state,
        projectId: action.projectId,
        title: action.title,
        folderId: action.folderId,
        stems,
        duration,
        referenceIdx,
        // Both actions land before playback starts (loading was set until now),
        // so resetting transport state is safe.
        isPlaying: false,
        loop: null,
        loopArmed: false,
        status: action.status,
        loading: null,
      };
    }
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
    case 'SET_DURATION':
      return { ...state, duration: action.duration, referenceIdx: action.referenceIdx };
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

function mergeBuffers(
  stems: LoadedStem[],
  buffers: Array<{ serverId: string | null; buffer: AudioBuffer | null }>,
): LoadedStem[] {
  const byId = new Map<string, AudioBuffer | null>();
  for (const b of buffers) {
    if (b.serverId != null) byId.set(b.serverId, b.buffer);
  }
  return stems.map((s, i) => {
    const incoming =
      s.serverId != null && byId.has(s.serverId)
        ? byId.get(s.serverId)
        : buffers[i]?.buffer;
    // A null/undefined incoming buffer leaves the stem unchanged — that's how
    // MP3 (segment-played) stems and errored stems pass through HEADS_READY
    // without clobbering an existing buffer or forcing one they don't use.
    const buf = incoming ?? s.audioBuffer;
    return buf === s.audioBuffer ? s : { ...s, audioBuffer: buf };
  });
}

function stemDuration(s: LoadedStem): number {
  // Decoded buffer is authoritative once available; before decode, fall back
  // to the <audio> element's duration (rarely populated with preload=metadata)
  // and finally the server-supplied metadata duration so the timeline can lay
  // itself out during the background download.
  if (s.audioBuffer && isFinite(s.audioBuffer.duration)) return s.audioBuffer.duration;
  if (isFinite(s.audio.duration) && s.audio.duration > 0) return s.audio.duration;
  if (s.metaDuration != null && isFinite(s.metaDuration)) return s.metaDuration;
  return 0;
}

function durationAndReference(stems: LoadedStem[]): {
  duration: number;
  referenceIdx: number;
} {
  const durations = stems.map(stemDuration);
  const duration = durations.reduce((m, d) => Math.max(m, isFinite(d) ? d : 0), 0);
  return { duration, referenceIdx: longestStemIdx(durations) };
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

  // Decoded MP3 segments per stem, OUTSIDE React state: a stem can fill in a
  // dozen segments during a single playback session, and routing each through
  // the reducer would re-render the whole player per segment for no UI benefit
  // (Phase 1 renders no per-segment UI). Keyed by serverId (or `idx:N` for
  // local-folder loads). Non-MP3 stems are absent here and play from their
  // single audioBuffer instead. Cleared in load() teardown and on unmount.
  const segmentsRef = useRef<Map<string, StemSegments>>(new Map());

  // Session anchor index for the current play/seek session: j = floor(offset /
  // SEGMENT_SEC), set by startSourcesAt. A stem's segment index i >= j is placed
  // at sessionTimings(j, durations, SEGMENT_SEC). scheduleDecodedSegment reads
  // this so late-arriving segments time against the anchor we started from.
  const playAnchorIndexRef = useRef(0);

  // Generation counter for load(). Audio now decodes in the background, so a
  // fast project switch can leave a previous load's decode still in flight.
  // Each load() bumps this; the older invocation's progress + HEADS_READY
  // dispatches no-op once a newer load has started, so a stale decode can't
  // clobber the new project's stems (wrong buffers) or prematurely clear its
  // loading state.
  const loadGenRef = useRef(0);

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

  // Silent looping HTMLAudioElement that anchors the Android system Media
  // Session. Chrome on Android only surfaces notification/lock-screen media
  // controls when an audible <audio>/<video> element is playing — Web Audio
  // alone (which drives all real sound here) doesn't qualify. The file is
  // true silence so the user hears nothing. iOS doesn't need this; iOS
  // Safari anchors Now Playing to the active AudioContext.
  const mediaSessionAnchorRef = useRef<HTMLAudioElement | null>(null);

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

  // Snapshot a stem's decoded-segment durations keyed by plan index.
  function stemDurations(entry: StemSegments): Map<number, number> {
    const m = new Map<number, number>();
    for (const [idx, seg] of entry.segments) m.set(idx, seg.duration);
    return m;
  }
  // Per-session timings for a stem's contiguous decoded run starting at the
  // session anchor index. Index `anchorIdx` sits at anchorIdx*SEGMENT_SEC;
  // later contiguous indices accumulate actual decoded durations. Stops at the
  // first forward gap (a missing/errored index), so any segment behind a gap is
  // absent — never scheduled into the running session.
  function stemTimings(entry: StemSegments, anchorIdx: number): Map<number, SegTiming> {
    return sessionTimings(anchorIdx, stemDurations(entry), SEGMENT_SEC);
  }

  // Schedule one already-decoded segment that arrived (or was seeked into)
  // mid-playback. Synchronous (no await) so it stays inside the user-activation
  // window when called from the play path. computeSegmentSchedule decides
  // whether the segment is in the past (skip), straddling the playhead (start
  // now at an offset), or in the future (start at its absolute ctx time).
  function scheduleDecodedSegment(stemIdx: number, segIdx: number): void {
    const ctx = audioCtxRef.current;
    if (!ctx || !isPlayingInternalRef.current) return;
    const stem = stateRef.current.stems[stemIdx];
    const entry =
      stem && stem.gain ? segmentsRef.current.get(stemKey(stem.serverId, stemIdx)) : undefined;
    if (!entry || !stem.gain) return;
    const t = stemTimings(entry, playAnchorIndexRef.current).get(segIdx);
    if (!t) return; // not in the current schedulable contiguous run (behind a gap)
    const seg = entry.segments.get(segIdx)!;
    // pNow MUST be derived as posAtPlay + (ctxNow - ctxAtPlay) for the
    // scheduler's future-segment math to hold — computeCurrentTime() does
    // exactly that, so always use it here for late arrivals.
    const r = computeSegmentSchedule(
      { startSec: t.startSec, endSec: t.endSec },
      { ctxAtPlay: playStartCtxTimeRef.current, posAtPlay: playStartOffsetRef.current },
      computeCurrentTime(),
      ctx.currentTime,
    );
    if (r.skip) return;
    const src = ctx.createBufferSource();
    src.buffer = seg.buffer;
    src.connect(stem.gain);
    src.start(r.when, r.offset);
    (sourcesRef.current ??= []).push(src);
  }

  function startSourcesAt(offset: number): boolean {
    const ctx = audioCtxRef.current;
    if (!ctx) return false;
    const stems = stateRef.current.stems;
    const startWhen = ctx.currentTime + 0.05; // 50ms lookahead
    // Set the play anchor FIRST so scheduleDecodedSegment / computeSegmentSchedule
    // (which derive segment timing from these refs) compute against the anchor
    // we're starting from, not a stale one.
    sourcesRef.current = [];
    playStartCtxTimeRef.current = startWhen;
    playStartOffsetRef.current = offset;
    const anchorIdx = Math.floor(offset / SEGMENT_SEC);
    playAnchorIndexRef.current = anchorIdx;
    let pendingSegments = false;
    for (let i = 0; i < stems.length; i++) {
      const stem = stems[i];
      if (!stem.gain) continue;
      const entry = segmentsRef.current.get(stemKey(stem.serverId, i));
      if (entry) {
        // Segment-played (MP3) stem: schedule each decoded segment in the
        // contiguous run anchored at this session's anchor index. Index
        // anchorIdx sits at anchorIdx*SEGMENT_SEC; later indices accumulate
        // actual durations. Pass `offset` as pNow because at play time the
        // playhead sits exactly at posAtPlay (== offset). Segments not yet
        // decoded fill in later via scheduleDecodedSegment.
        pendingSegments = true;
        const timings = stemTimings(entry, anchorIdx);
        for (const [idx, t] of timings) {
          const seg = entry.segments.get(idx)!;
          const r = computeSegmentSchedule(
            { startSec: t.startSec, endSec: t.endSec },
            { ctxAtPlay: startWhen, posAtPlay: offset },
            offset,
            ctx.currentTime,
          );
          if (r.skip) continue;
          const src = ctx.createBufferSource();
          src.buffer = seg.buffer;
          src.connect(stem.gain);
          src.start(r.when, r.offset);
          sourcesRef.current.push(src);
        }
        continue;
      }
      // Single-buffer (non-MP3 / full-file) stem: unchanged behavior.
      if (!stem.audioBuffer) continue;
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
      sourcesRef.current.push(src);
    }
    // Play if we scheduled anything OR any stem has segments still streaming in
    // (segment 0 may be the only decoded one when play is hit immediately after
    // head-start). Without the pendingSegments clause, play would bail when the
    // current offset lands before segment 0 hasn't covered it yet.
    if (!sourcesRef.current.length && !pendingSegments) {
      sourcesRef.current = null;
      return false;
    }
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
      segmentsRef.current.clear();
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

  // ---- Android Media Session anchor ----
  // Construct a single looping silent-audio element on mount. Lazily — only
  // on Android, since iOS doesn't need it and on iOS a parallel HTMLAudio
  // would compete with Web Audio for the shared audio session.
  useEffect(() => {
    if (typeof window === 'undefined' || !isAndroid()) return;
    const audio = new Audio(SILENT_AUDIO_URL);
    audio.loop = true;
    audio.preload = 'auto';
    // File is true silence; volume doesn't affect audibility but Chrome
    // won't anchor a muted element to the system media session.
    audio.volume = 1;
    mediaSessionAnchorRef.current = audio;
    return () => {
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      } catch {
        // ignore
      }
      mediaSessionAnchorRef.current = null;
    };
  }, []);

  // Drive the anchor's play/pause from state.isPlaying. Sharing the source of
  // truth with MediaSession.playbackState above means end-of-song (rAF tick
  // flips isPlaying to false without calling pause()) also stops the anchor.
  useEffect(() => {
    const anchor = mediaSessionAnchorRef.current;
    if (!anchor) return;
    if (state.isPlaying) {
      // Best-effort. play() may reject if user activation has lapsed
      // (e.g. tab restored from bfcache); the next user tap recovers.
      void anchor.play().catch(() => {});
    } else {
      try {
        anchor.pause();
      } catch {
        // ignore
      }
    }
  }, [state.isPlaying]);

  // ---- API ----
  const load = useCallback<PlayerControls['load']>(async (input) => {
    // Claim this load; a later load() bumps the generation so this one's
    // background decode stops mutating shared state once it's superseded.
    const myGen = ++loadGenRef.current;
    // Tear down current stems before building new ones.
    stopSources();
    // Release the previous load's decoded segments so their AudioBuffers can be
    // garbage-collected; the new load rebuilds this map from scratch.
    segmentsRef.current.clear();
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

    const displayNames = stripCommonPrefix(input.sources.map((it) => it.name));
    // Build every stem synchronously, with audioBuffer still null. Dispatching
    // these up front lets the waveform (from precomputed peaks), sections,
    // comments, and timeline render immediately — sized by the server-supplied
    // metaDuration — while the audio bytes download/decode in the background.
    const built: LoadedStem[] = input.sources.map((src, i) => {
      const audio = new Audio();
      // Web Audio drives all sound; the element only exists so WaveSurfer has a
      // `media` binding and so Track can listen for `error` (ghost-stem
      // detection). `metadata` fetches enough to surface a 410 without racing
      // the real Web Audio decode for connection bandwidth (issue #194).
      audio.preload = 'metadata';
      audio.muted = true;
      audio.src = src.src;
      const userVolume = loadVolume(input.projectId, src.name);
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
        projectId: input.projectId,
        serverId: src.serverId ?? null,
        revoke: src.revoke,
        gain,
        peaks: src.peaks ?? null,
        metaDuration:
          src.durationMs != null && isFinite(src.durationMs)
            ? src.durationMs / 1000
            : null,
      };
    });

    dispatch({
      type: 'LOAD_START',
      stems: built,
      projectId: input.projectId,
      title: input.title,
      folderId: input.folderId,
      total: input.sources.length,
      status: `Loading ${input.sources.length} stem${input.sources.length === 1 ? '' : 's'}…`,
    });

    const errored: string[] = [];
    // Per-stem fill plan, captured by the HEAD step and consumed by the
    // background fill. Only MP3 stems with a multi-segment plan get an entry;
    // non-MP3 / single-segment stems are absent (already fully decoded).
    type FillPlan = { url: string; plan: PlannedSegment[]; bytesPerSec: number };
    const fillPlans: Array<FillPlan | null> = built.map(() => null);
    // Each stem owns a 1.0 budget in the loading bar. The head step spends a
    // fraction of it; once HEADS_READY clears `loading`, the remaining fill
    // progresses without a visible bar, so we keep this accounting simple —
    // just enough that the bar moves and doesn't stick before play unblocks.
    const HEAD_FRACTION = 0.5;

    const headSteps = built.map(async (s, i) => {
      const url = input.sources[i].src;
      const bumpHead = () => {
        if (loadGenRef.current === myGen) {
          dispatch({ type: 'LOAD_PROGRESS', delta: HEAD_FRACTION });
        }
      };
      const finishStep = () => {
        // Top the stem's budget up to a full 1.0 once its head is ready, so the
        // bar reaches 100% by HEADS_READY even though the fill continues after.
        if (loadGenRef.current === myGen) {
          dispatch({ type: 'LOAD_PROGRESS', delta: 1 - HEAD_FRACTION });
        }
      };
      // Full-file decode fallback (non-MP3, no metadata, or a failed probe).
      // Behaves exactly as the pre-segment code did: decode the whole file into
      // a single audioBuffer, no segmentsRef entry.
      const fullDecode = async () => {
        const buf = await decodeStem(graph.ctx, url, () => {});
        if (buf) built[i].audioBuffer = buf;
        else errored.push(s.name);
      };

      try {
        const head = await fetchSegmentBytes(url, 0, PROBE_BYTES);
        const metaDuration = built[i].metaDuration;
        if (isMp3(head.bytes) && metaDuration != null && metaDuration > 0) {
          const plan = planSegments(head.totalBytes, metaDuration);
          if (plan.length === 0) {
            await fullDecode();
            finishStep();
            return;
          }
          // Decode segment 0, reusing the probe bytes when they already cover it.
          const seg0End = plan[0].byteEnd;
          const raw0 =
            head.bytes.length >= seg0End
              ? head.bytes.subarray(0, seg0End)
              : (await fetchSegmentBytes(url, 0, seg0End)).bytes;
          const buf0 = await decodeSegment(raw0, { isFirst: true });
          if (loadGenRef.current !== myGen) return;
          const entry: StemSegments = {
            gain: built[i].gain!,
            segments: new Map(),
            errored: new Set(),
          };
          entry.segments.set(0, { buffer: buf0, duration: buf0.duration });
          segmentsRef.current.set(stemKey(built[i].serverId, i), entry);
          // MP3 stems play from segments, not the single buffer — leave
          // audioBuffer null. Record the plan + a CBR bytes/sec for the fill.
          fillPlans[i] = { url, plan, bytesPerSec: head.totalBytes / metaDuration };
          bumpHead();
          finishStep();
          return;
        }
        // Probe succeeded but the stem isn't a segment-able MP3 — full decode.
        bumpHead();
        await fullDecode();
        finishStep();
      } catch {
        // Probe (or segment-0 decode) failed — fall back to the full-file path.
        // If that also fails, the stem is marked errored inside fullDecode.
        try {
          await fullDecode();
        } catch {
          errored.push(s.name);
        }
        finishStep();
      }
    });

    await Promise.all(headSteps);

    // A newer load() superseded this one while its heads were decoding — its
    // LOAD_START already owns the player state. Bail before HEADS_READY so this
    // stale load can't merge the wrong buffers or clear the new project's
    // loading indicator.
    if (loadGenRef.current !== myGen) return;

    // Every stem is now playable from its head. Merge any non-MP3 full buffers,
    // recompute duration, and clear `loading` so togglePlay is unblocked. For
    // MP3 stems, stemDuration falls back to metaDuration (audioBuffer is null),
    // so the timeline stays correctly sized until the fill lands.
    const headDuration = built
      .map((s) => stemDuration(s))
      .reduce((m, d) => Math.max(m, isFinite(d) ? d : 0), 0);
    const okCount = built.length - errored.length;
    let headStatus = `Buffering ${okCount} stem${okCount === 1 ? '' : 's'}`;
    if (headDuration) headStatus += ` · ${fmt(headDuration)}`;
    if (errored.length) headStatus += ` · failed: ${errored.join(', ')}`;

    dispatch({
      type: 'HEADS_READY',
      buffers: built.map((s) => ({ serverId: s.serverId, buffer: s.audioBuffer })),
      projectId: input.projectId,
      title: input.title,
      folderId: input.folderId,
      status: headStatus,
    });

    // ---- Background fill (fire-and-forget) ----
    // For each MP3 stem, fetch + decode segments 1..N sequentially. A segment
    // decoded mid-playback is scheduled immediately so it joins the running
    // playhead at the right absolute time. One bad segment stops that stem's
    // fill (audio ends early at the last good segment) but never the others.
    const fillStem = async (i: number): Promise<void> => {
      const fp = fillPlans[i];
      if (!fp) return;
      const key = stemKey(built[i].serverId, i);
      // Capture the entry ONCE. If a newer load() supersedes this one it calls
      // segmentsRef.clear(), so this captured reference becomes an orphaned
      // object — subsequent push/schedule here mutate that dead object, never
      // the live map. The per-await loadGenRef guards below also short-circuit
      // before any push/schedule, so a superseded fill is doubly inert.
      const entry = segmentsRef.current.get(key);
      if (!entry) return;
      for (let k = 1; k < fp.plan.length; k++) {
        if (loadGenRef.current !== myGen) return;
        const p = fp.plan[k];
        try {
          const { bytes } = await fetchSegmentBytes(fp.url, p.fetchStart, p.byteEnd);
          if (loadGenRef.current !== myGen) return;
          const buf = await decodeSegment(bytes, {
            isFirst: false,
            leadInSec: p.leadInBytes / fp.bytesPerSec,
          });
          if (loadGenRef.current !== myGen) return;
          // Store by plan index; per-session timing is derived in stemTimings
          // from the session anchor, not stored here.
          entry.segments.set(k, { buffer: buf, duration: buf.duration });
          // If we're already playing, schedule this just-arrived segment so it
          // starts at its absolute ctx time relative to the play anchor.
          if (isPlayingInternalRef.current) scheduleDecodedSegment(i, k);
        } catch {
          // Mark this index errored and stop this stem's fill; the rest of the
          // stems keep filling.
          entry.errored.add(k);
          return;
        }
      }
    };

    void Promise.all(built.map((_, i) => fillStem(i))).then(() => {
      // All fills done (or stopped). Reconcile duration from the SUMMED actual
      // decoded segment durations, then update the status line — both WITHOUT a
      // HEADS_READY dispatch, which resets isPlaying/loop and would clobber a
      // playback session that may already be running.
      if (loadGenRef.current !== myGen) return;
      // The summed decoded duration is authoritative for MP3 stems: lead-in
      // trimming + frame-snap rounding accumulate across segments, so the true
      // audio length drifts from the server `metaDuration` (only an estimate
      // used for the initial pre-decode timeline layout). For a segmented stem
      // use its last segment's endSec; for a full-decode stem fall back to
      // stemDuration. Take the max as the song duration and the argmax as the
      // reference idx, consistent with durationAndReference.
      const effective = built.map((s, i) => {
        const entry = segmentsRef.current.get(stemKey(s.serverId, i));
        if (entry) {
          // A segmented stem's length = sum of actual durations over its
          // contiguous prefix from index 0; stops at the first gap.
          let total = 0;
          for (let k = 0; entry.segments.has(k); k++) total += entry.segments.get(k)!.duration;
          return total;
        }
        return stemDuration(s);
      });
      const duration = effective.reduce((m, d) => Math.max(m, isFinite(d) ? d : 0), 0);
      const referenceIdx = longestStemIdx(effective);
      dispatch({ type: 'SET_DURATION', duration, referenceIdx });
      let status = `${okCount} stem${okCount === 1 ? '' : 's'} loaded`;
      if (duration) status += ` · ${fmt(duration)}`;
      if (errored.length) status += ` · failed: ${errored.join(', ')}`;
      dispatch({ type: 'SET_STATUS', status });
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
    // Audio is still downloading/decoding — the stems render (waveform,
    // sections, comments are usable) but there are no buffers to schedule yet.
    // Acknowledge the attempt (flash + announce the loading indicator) instead
    // of silently doing nothing.
    if (s.loading) {
      dispatch({ type: 'NUDGE_LOADING' });
      return;
    }
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
    const idx = stateRef.current.stems.findIndex((s) => s.serverId === serverId);
    const stem = idx >= 0 ? stateRef.current.stems[idx] : undefined;
    if (stem) {
      try {
        stem.gain?.disconnect();
        stem.revoke?.();
      } catch {
        // ignore
      }
      // Drop the removed stem's decoded segments so its AudioBuffers can be GC'd
      // and a still-running background fill stops scheduling onto the now
      // disconnected gain. removeStem is server-stems-only, so the key is the
      // serverId (matching how startSourcesAt/load construct it).
      segmentsRef.current.delete(stemKey(stem.serverId, idx));
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

// Smallest fraction-of-one-stem change worth a dispatch. Streaming a large
// file yields hundreds of chunks; dispatching per chunk would thrash React.
// Coalescing to ~1% steps keeps the bar smooth without a re-render storm.
const PROGRESS_EPSILON = 0.01;

async function decodeStem(
  ctx: AudioContext,
  url: string,
  onProgress?: (deltaFraction: number) => void,
): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    const total = Number(res.headers?.get('Content-Length')) || 0;
    // Stream the body so the loading bar can track bytes in real time. Falls
    // back to a single buffered read when we can't measure progress (no
    // Content-Length, or no readable body), in which case the caller tops the
    // stem up to a full step once decode finishes.
    const buf =
      onProgress && res.body && total > 0
        ? await readBodyWithProgress(res.body, total, onProgress)
        : await res.arrayBuffer();
    return await ctx.decodeAudioData(buf);
  } catch {
    return null;
  }
}

// Read a response body to completion, reporting download progress as a stream
// of deltas — each a fraction of this one stem, summing to ~1.0 across the
// whole file. Deltas below PROGRESS_EPSILON are accumulated and flushed once
// they cross the threshold, so the caller dispatches at most ~100 times per
// stem rather than once per network chunk.
async function readBodyWithProgress(
  body: ReadableStream<Uint8Array>,
  total: number,
  onProgress: (deltaFraction: number) => void,
): Promise<ArrayBuffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let pending = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    pending += value.length / total;
    if (pending >= PROGRESS_EPSILON) {
      onProgress(pending);
      pending = 0;
    }
  }
  if (pending > 0) onProgress(pending);
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged.buffer;
}

