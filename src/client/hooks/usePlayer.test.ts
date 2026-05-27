// First-pass tests for the usePlayer hook.
//
// usePlayer.ts orchestrates Web Audio scheduling, decode, drift correction,
// seek coalescing, loop wrap, mute/solo, and per-track gain.
// This file covers a focused subset of load-bearing state-machine behaviors —
// it is NOT exhaustive. Follow-up coverage (rAF tick / loop wrap / end-of-song /
// seek coalescing / cleanup-on-unmount / decode-failure / master-volume gain
// side-effect / audio-context resume path) is captured in
// ~/projects/plans/2026-05-14-paperstem-useplayer-tests-followup.md.
//
// Harness notes:
// - happy-dom doesn't implement Web Audio. We stub AudioContext + HTMLAudioElement
//   minimally with vi.stubGlobal.
// - decodeStem() inside the hook calls fetch() then ctx.decodeAudioData(); we
//   stub fetch to return an ArrayBuffer and rely on FakeAudioContext.decodeAudioData
//   to return a fake AudioBuffer with duration=60.
// - We do NOT exercise the rAF tick — tests assert the *synchronous* effects of
//   each control. The internal isPlayingInternalRef is observed indirectly via
//   the next togglePlay/pause cycle.

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

class FakeGainNode {
  gain = { value: 1, setValueAtTime: () => {} };
  connect = () => {};
  disconnect = () => {};
}

class FakeBufferSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connect = () => {};
  disconnect = () => {};
  start = () => {};
  stop = () => {};
}

// Byte lengths handed to decodeAudioData, in call order. Lets a test assert
// that the streaming read path concatenates chunks into a correctly-sized
// buffer. Reset in beforeEach.
const decodedByteLengths: number[] = [];

class FakeAudioContext {
  currentTime = 0;
  destination = {} as unknown;
  state: 'running' | 'suspended' | 'closed' = 'running';
  createGain() {
    return new FakeGainNode();
  }
  createBufferSource() {
    return new FakeBufferSource();
  }
  decodeAudioData(buf: ArrayBuffer): Promise<unknown> {
    decodedByteLengths.push(buf.byteLength);
    return Promise.resolve({
      duration: 60,
      length: 60 * 44100,
      numberOfChannels: 2,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(),
      copyFromChannel: () => {},
      copyToChannel: () => {},
    });
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

// happy-dom's HTMLAudioElement constructor (`new Audio()`) works but triggers
// a network fetch for the .src URL we set. The test-setup filter swallows the
// 404 noise, so we leave it as-is rather than stubbing the constructor.

vi.stubGlobal('AudioContext', FakeAudioContext);
vi.stubGlobal('webkitAudioContext', FakeAudioContext);
vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as unknown as typeof fetch,
);

// Import AFTER the globals are stubbed.
import { usePlayer } from './usePlayer';
import { planSegments } from '../lib/segment-stream';

function makeSources(...names: string[]) {
  return names.map((name, i) => ({
    name,
    src: `https://example.test/${name}.mp3`,
    serverId: `srv-${i}`,
  }));
}

describe('usePlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    decodedByteLengths.length = 0;
  });

  it('starts in an empty paused state', () => {
    const { result } = renderHook(() => usePlayer());
    expect(result.current.state.isPlaying).toBe(false);
    expect(result.current.state.stems).toEqual([]);
    expect(result.current.state.duration).toBe(0);
    expect(result.current.currentTime).toBe(0);
    expect(result.current.state.loop).toBeNull();
  });

  it('load() with empty sources resets to teardown state', async () => {
    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'p1',
        title: 'unused',
        folderId: null,
        sources: [],
      });
    });
    expect(result.current.state.stems).toEqual([]);
    expect(result.current.state.title).toBe('—');
    expect(result.current.state.projectId).toBeNull();
  });

  it('load() populates stems, duration, and project metadata', async () => {
    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'proj-1',
        title: 'My Song',
        folderId: 'folder-xyz',
        sources: makeSources('drums.mp3', 'bass.mp3'),
      });
    });
    expect(result.current.state.stems).toHaveLength(2);
    expect(result.current.state.projectId).toBe('proj-1');
    expect(result.current.state.title).toBe('My Song');
    // FakeAudioContext.decodeAudioData returns duration=60.
    expect(result.current.state.duration).toBe(60);
    expect(result.current.state.stems[0].audioBuffer).not.toBeNull();
    expect(result.current.state.isPlaying).toBe(false);
  });

  it('load() streams the response body and concatenates chunks for decode', async () => {
    // Three equal chunks behind a known Content-Length. The streaming read path
    // must report byte-level progress and hand decodeAudioData a buffer of the
    // full concatenated size. arrayBuffer() deliberately returns a wrong size
    // so that, if the code fell back to the non-streaming path, the byte-length
    // assertion below would fail — proving the stream path actually ran and its
    // chunk-concatenation offset math is correct.
    const chunks = [new Uint8Array(100), new Uint8Array(100), new Uint8Array(100)];
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      let i = 0;
      return {
        ok: true,
        headers: {
          get: (n: string) => (n.toLowerCase() === 'content-length' ? '300' : null),
        },
        body: {
          getReader: () => ({
            read: async () =>
              i < chunks.length
                ? { done: false, value: chunks[i++] }
                : { done: true, value: undefined },
          }),
        },
        arrayBuffer: async () => new ArrayBuffer(8),
      };
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'p',
        title: 't',
        folderId: null,
        sources: makeSources('only.mp3'),
      });
    });

    expect(result.current.state.stems).toHaveLength(1);
    expect(decodedByteLengths).toEqual([300]);
  });

  it('togglePlay() is a no-op when no stems are loaded', async () => {
    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(false);
  });

  it('togglePlay() + pause() round-trips isPlaying', async () => {
    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'p',
        title: 't',
        driveFolderId: null,
        sources: makeSources('a.mp3', 'b.mp3'),
      });
    });
    await act(async () => {
      await result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(true);
    act(() => {
      result.current.pause();
    });
    expect(result.current.state.isPlaying).toBe(false);
  });

  it('seek() clamps to [0, duration] and updates currentTime synchronously', async () => {
    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'p',
        title: 't',
        driveFolderId: null,
        sources: makeSources('a.mp3'),
      });
    });
    // duration is 60 from FakeAudioContext.
    act(() => {
      result.current.seek(10);
    });
    expect(result.current.currentTime).toBe(10);

    act(() => {
      result.current.seek(-5);
    });
    expect(result.current.currentTime).toBe(0);

    act(() => {
      result.current.seek(9999);
    });
    expect(result.current.currentTime).toBe(60);
  });

  it('toggleMute(idx) flips only the targeted stem', async () => {
    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'p',
        title: 't',
        driveFolderId: null,
        sources: makeSources('a.mp3', 'b.mp3', 'c.mp3'),
      });
    });
    act(() => {
      result.current.toggleMute(1);
    });
    expect(result.current.state.stems[0].userMuted).toBe(false);
    expect(result.current.state.stems[1].userMuted).toBe(true);
    expect(result.current.state.stems[2].userMuted).toBe(false);
    act(() => {
      result.current.toggleMute(1);
    });
    expect(result.current.state.stems[1].userMuted).toBe(false);
  });

  it('toggleSolo(idx) flips only the targeted stem', async () => {
    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'p',
        title: 't',
        driveFolderId: null,
        sources: makeSources('a.mp3', 'b.mp3'),
      });
    });
    act(() => {
      result.current.toggleSolo(0);
    });
    expect(result.current.state.stems[0].soloed).toBe(true);
    expect(result.current.state.stems[1].soloed).toBe(false);
  });

  it('setLoop / setLoopEnabled / clearLoop transition the loop region', async () => {
    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'p',
        title: 't',
        driveFolderId: null,
        sources: makeSources('a.mp3'),
      });
    });
    act(() => {
      result.current.setLoop(5, 15);
    });
    expect(result.current.state.loop).toEqual({ start: 5, end: 15, enabled: true });

    act(() => {
      result.current.setLoopEnabled(false);
    });
    expect(result.current.state.loop?.enabled).toBe(false);

    act(() => {
      result.current.toggleLoopEnabled();
    });
    expect(result.current.state.loop?.enabled).toBe(true);

    act(() => {
      result.current.clearLoop();
    });
    expect(result.current.state.loop).toBeNull();
  });

  it('renameStem(serverId, name) updates the matching stem only', async () => {
    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'p',
        title: 't',
        driveFolderId: null,
        sources: makeSources('drums.mp3', 'bass.mp3'),
      });
    });
    act(() => {
      result.current.renameStem('srv-1', 'Bass (renamed)');
    });
    expect(result.current.state.stems[0].displayName).not.toBe('Bass (renamed)');
    expect(result.current.state.stems[1].displayName).toBe('Bass (renamed)');
  });

  it('removeStem(serverId) drops the stem and keeps referenceIdx valid', async () => {
    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'p',
        title: 't',
        driveFolderId: null,
        sources: makeSources('a.mp3', 'b.mp3', 'c.mp3'),
      });
    });
    expect(result.current.state.stems).toHaveLength(3);
    act(() => {
      result.current.removeStem('srv-1');
    });
    expect(result.current.state.stems).toHaveLength(2);
    expect(result.current.state.stems.map((s) => s.serverId)).toEqual(['srv-0', 'srv-2']);
    expect(result.current.state.referenceIdx).toBeGreaterThanOrEqual(0);
    expect(result.current.state.referenceIdx).toBeLessThan(2);
  });

  it('clear() returns the player to its empty initial state', async () => {
    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'p',
        title: 't',
        driveFolderId: null,
        sources: makeSources('a.mp3'),
      });
    });
    act(() => {
      result.current.seek(20);
    });
    expect(result.current.currentTime).toBe(20);

    act(() => {
      result.current.clear();
    });
    expect(result.current.state.stems).toEqual([]);
    expect(result.current.state.duration).toBe(0);
    expect(result.current.state.isPlaying).toBe(false);
    expect(result.current.currentTime).toBe(0);
    expect(result.current.state.projectId).toBeNull();
  });

  it('setMasterVolume() persists to state (and clamps via gain side-effect)', () => {
    const { result } = renderHook(() => usePlayer());
    act(() => {
      result.current.setMasterVolume(7);
    });
    expect(result.current.state.masterVolume).toBe(7);
    // Note: the reducer does NOT clamp the stored masterVolume value; clamping
    // happens in volumeToGain when the value is applied to the gain node. This
    // test pins the current contract — change it deliberately if clamping moves.
  });
});

// ---------------------------------------------------------------------------
// Phase A — rAF / time-driven behaviors
//
// These tests require two harness improvements over Phase 1:
//   1. A controllable rAF queue — callbacks are collected and flushed manually
//      so we can advance time one tick at a time without relying on real timers.
//   2. A capturable AudioContext — we grab the instance the hook creates so we
//      can advance ctx.currentTime and observe scheduling side-effects.
//
// LOOP_TAIL = 0.005 and END_TAIL = 0.02 are constants in usePlayer.ts.
// FakeAudioContext.decodeAudioData returns duration = 60.
// ---------------------------------------------------------------------------

// Extend FakeAudioContext so we can capture the instance the hook creates and
// mutate ctx.currentTime between ticks. The capture reference lives in the
// outer describe closure so each beforeEach can reset it.
class CapturingAudioContext extends FakeAudioContext {
  static last: CapturingAudioContext | null = null;
  constructor() {
    super();
    CapturingAudioContext.last = this;
  }
  // Override createBufferSource to count start() calls for seek-coalescing test.
  startCallCount = 0;
  override createBufferSource() {
    const src = super.createBufferSource();
    const origStart = src.start.bind(src);
    src.start = (...args: Parameters<typeof src.start>) => {
      this.startCallCount++;
      origStart(...args);
    };
    return src;
  }
}

describe('usePlayer Phase A — rAF / time-driven behaviors', () => {
  // ---------------------------------------------------------------------------
  // rAF queue
  // ---------------------------------------------------------------------------
  let rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  let rafIdCounter = 0;

  function flushRaf(): void {
    // Drain the current queue in one pass; callbacks that re-schedule are
    // collected into rafQueue for the next flushRaf() call.
    const batch = rafQueue.splice(0);
    for (const entry of batch) entry.cb(0);
  }

  beforeEach(() => {
    rafQueue = [];
    rafIdCounter = 0;
    CapturingAudioContext.last = null;

    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = ++rafIdCounter;
      rafQueue.push({ id, cb });
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      const idx = rafQueue.findIndex((entry) => entry.id === id);
      if (idx >= 0) rafQueue.splice(idx, 1);
    });
    vi.stubGlobal('AudioContext', CapturingAudioContext);
    vi.stubGlobal('webkitAudioContext', CapturingAudioContext);
  });

  afterEach(() => {
    // Restore to Phase 1 stubs so the describe blocks don't interfere.
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('webkitAudioContext', FakeAudioContext);
    vi.stubGlobal('requestAnimationFrame', (_cb: FrameRequestCallback) => 0);
    vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});
  });

  // Helper: load one stem and start playback. Returns the hook result.
  async function loadAndPlay(hookResult: ReturnType<typeof renderHook<ReturnType<typeof usePlayer>, unknown>>['result']) {
    await act(async () => {
      await hookResult.current.load({
        projectId: 'p',
        title: 't',
        folderId: null,
        sources: makeSources('a.mp3'),
      });
    });
    await act(async () => {
      await hookResult.current.togglePlay();
    });
    expect(hookResult.current.state.isPlaying).toBe(true);
  }

  // ---------------------------------------------------------------------------
  // rAF tick advancing currentTime
  // ---------------------------------------------------------------------------
  it('rAF tick updates currentTime when playing', async () => {
    const { result } = renderHook(() => usePlayer());
    await loadAndPlay(result);

    const ctx = CapturingAudioContext.last!;
    expect(ctx).not.toBeNull();

    // After togglePlay, startSourcesAt sets playStartCtxTimeRef = ctx.currentTime + 0.05.
    // Advance ctx.currentTime by 5 seconds so computeCurrentTime = 5 - 0.05 = 4.95.
    ctx.currentTime = 5;

    act(() => {
      flushRaf();
    });

    // currentTime should reflect the elapsed playback time (4.95 s).
    // We check > 0 and < duration rather than exact equality to avoid tying
    // the test to the 50 ms lookahead constant.
    expect(result.current.currentTime).toBeGreaterThan(0);
    expect(result.current.currentTime).toBeLessThan(60);
  });

  it('rAF tick does not update currentTime while paused', async () => {
    const { result } = renderHook(() => usePlayer());
    await loadAndPlay(result);

    // Pause so isPlayingInternalRef = false.
    act(() => {
      result.current.pause();
    });

    const ctx = CapturingAudioContext.last!;
    ctx.currentTime = 10;

    act(() => {
      flushRaf();
    });

    // pause() captures pausedOffset at the time of pause (≈0 since ctx.currentTime
    // was 0 when we paused). After flush, currentTime must not have advanced.
    expect(result.current.currentTime).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Loop wrap on rAF tick
  // ---------------------------------------------------------------------------
  it('rAF tick wraps playhead to loop.start when crossing loop.end', async () => {
    const { result } = renderHook(() => usePlayer());
    await loadAndPlay(result);

    // Set a loop: [10, 30].  LOOP_TAIL = 0.005, so wrap fires when t >= 29.995.
    act(() => {
      result.current.setLoop(10, 30);
    });

    const ctx = CapturingAudioContext.last!;

    // Reset the start-call counter after the initial togglePlay so we can
    // assert that the loop wrap actually rescheduled the audio sources.
    ctx.startCallCount = 0;

    // Advance so computeCurrentTime crosses 29.995 in a single tick.
    // playStartCtxTimeRef = 0.05 (set by startSourcesAt at ctx.currentTime=0),
    // playStartOffsetRef = 0.
    // We need playStartOffset + (ctx.currentTime - 0.05) >= 29.995
    // => ctx.currentTime >= 30.
    ctx.currentTime = 31;

    act(() => {
      flushRaf();
    });

    // After wrap, currentTime should be reset to loop.start = 10.
    expect(result.current.currentTime).toBe(10);
    // Player must still be playing.
    expect(result.current.state.isPlaying).toBe(true);
    // Sources must have been rescheduled at the new offset — without this,
    // audio would silently fall out of sync with the visual playhead.
    expect(ctx.startCallCount).toBeGreaterThan(0);
  });

  it('rAF tick does not wrap when loop is disabled', async () => {
    const { result } = renderHook(() => usePlayer());
    await loadAndPlay(result);

    act(() => {
      result.current.setLoop(10, 30);
      result.current.setLoopEnabled(false);
    });

    const ctx = CapturingAudioContext.last!;
    ctx.currentTime = 31;

    act(() => {
      flushRaf();
    });

    // No wrap — currentTime should have advanced past 30 (up to min(duration, t)).
    expect(result.current.currentTime).toBeGreaterThan(30);
    expect(result.current.state.isPlaying).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // End-of-song detection
  // ---------------------------------------------------------------------------
  it('rAF tick stops playback when currentTime reaches end of song', async () => {
    const { result } = renderHook(() => usePlayer());
    await loadAndPlay(result);

    const ctx = CapturingAudioContext.last!;

    // duration = 60.  END_TAIL = 0.02.  shouldEndPlayback fires when t >= 59.98.
    // playStartCtxTimeRef = 0.05, so we need ctx.currentTime - 0.05 >= 59.98
    // => ctx.currentTime >= 60.03.
    ctx.currentTime = 61;

    act(() => {
      flushRaf();
    });

    expect(result.current.state.isPlaying).toBe(false);
    expect(result.current.currentTime).toBe(0);
  });

  it('rAF tick does not stop playback before reaching END_TAIL threshold', async () => {
    const { result } = renderHook(() => usePlayer());
    await loadAndPlay(result);

    const ctx = CapturingAudioContext.last!;

    // One second before the end — well clear of END_TAIL = 0.02.
    ctx.currentTime = 59;

    act(() => {
      flushRaf();
    });

    expect(result.current.state.isPlaying).toBe(true);
    expect(result.current.currentTime).toBeGreaterThan(0);
    expect(result.current.currentTime).toBeLessThan(60);
  });

  // ---------------------------------------------------------------------------
  // Seek coalescing across rapid calls
  // ---------------------------------------------------------------------------
  it('seek() coalesces rapid calls — only the last target survives', async () => {
    const { result } = renderHook(() => usePlayer());
    await loadAndPlay(result);

    const ctx = CapturingAudioContext.last!;
    // Reset start-call counter after togglePlay already fired one set.
    ctx.startCallCount = 0;

    // Fire three rapid seeks while playing. Each updates currentTime immediately
    // (UI responsiveness), but only the last seek target should reach startSourcesAt.
    act(() => {
      result.current.seek(5);
      result.current.seek(15);
      result.current.seek(25);
    });

    // currentTime must already reflect the last seek target synchronously.
    expect(result.current.currentTime).toBe(25);

    // Now flush the one pending rAF — this fires the coalesced reschedule.
    act(() => {
      flushRaf();
    });

    // Exactly one startSourcesAt call (one set of createBufferSource().start()
    // calls — one per stem, and we have one stem).
    expect(ctx.startCallCount).toBe(1);
  });

  it('seek() while paused does not schedule a rAF', async () => {
    const { result } = renderHook(() => usePlayer());
    await loadAndPlay(result);

    act(() => {
      result.current.pause();
    });

    const initialQueueLength = rafQueue.length;

    act(() => {
      result.current.seek(20);
    });

    // Paused seek: no rAF should have been added to the queue.
    expect(rafQueue.length).toBe(initialQueueLength);
    expect(result.current.currentTime).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Deferred audio load — the UI (waveform/sections/comments/timeline) renders
// from precomputed peaks + server metadata immediately, while audio downloads
// and decodes in the background. Only playback waits for the decode.
//
// These tests gate fetch() per project (keyed by a substring in the stem URL)
// so we can both (a) observe the in-between state where stems exist but their
// buffers don't yet, and (b) control the order in which two concurrent loads
// finish — needed to exercise the stale-load guard.
// ---------------------------------------------------------------------------
describe('usePlayer — deferred audio load', () => {
  let releasers: Record<string, () => void>;
  let gates: Record<string, Promise<void>>;

  function gate(key: string): void {
    gates[key] = new Promise<void>((res) => {
      releasers[key] = res;
    });
  }
  function release(key: string): void {
    releasers[key]?.();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    releasers = {};
    gates = {};
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('webkitAudioContext', FakeAudioContext);
    // fetch resolves only once the gate for the project in its URL is released.
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string) => {
        const key = url.includes('/projA/')
          ? 'projA'
          : url.includes('/projB/')
            ? 'projB'
            : 'default';
        if (gates[key]) await gates[key];
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
      },
    );
  });

  afterEach(() => {
    // Drain any still-pending gates so dangling decodes settle.
    for (const key of Object.keys(releasers)) release(key);
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    );
  });

  function sourcesFor(proj: string, idPrefix: string) {
    return [
      { name: 'drums.mp3', src: `https://example.test/${proj}/drums.mp3`, serverId: `${idPrefix}0`, durationMs: 123_000 },
      { name: 'bass.mp3', src: `https://example.test/${proj}/bass.mp3`, serverId: `${idPrefix}1`, durationMs: 90_000 },
    ];
  }

  it('populates stems + duration from metadata before decode finishes, and gates play', async () => {
    gate('projA');
    const { result } = renderHook(() => usePlayer());
    let loadDone!: Promise<void>;
    await act(async () => {
      loadDone = result.current.load({
        projectId: 'projA',
        title: 't',
        folderId: null,
        sources: sourcesFor('projA', 'sA-'),
      });
      // Flush the synchronous LOAD_START dispatch (fetch/decode stays gated).
      await Promise.resolve();
    });

    // Stems render with no audio buffers yet; duration comes from the longest
    // stem's metadata (123 s), and the loading indicator is active.
    expect(result.current.state.stems).toHaveLength(2);
    expect(result.current.state.duration).toBe(123);
    expect(result.current.state.stems[0].audioBuffer).toBeNull();
    expect(result.current.state.stems[0].metaDuration).toBe(123);
    expect(result.current.state.loading).not.toBeNull();

    // Play is a no-op while audio is still loading.
    await act(async () => {
      await result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(false);

    // Releasing the gate resolves load() → HEADS_READY (full-file fallback
    // path — the mock fetch returns no Content-Range, so the head probe can't
    // segment and falls back to a full decode): buffers land, the loading
    // indicator clears, and the decoded duration (60) supersedes the metadata.
    await act(async () => {
      release('projA');
      await loadDone;
    });
    expect(result.current.state.loading).toBeNull();
    expect(result.current.state.stems[0].audioBuffer).not.toBeNull();
    expect(result.current.state.duration).toBe(60);
  });

  it('a play attempt during loading bumps loading.nudge without starting playback', async () => {
    gate('projA');
    const { result } = renderHook(() => usePlayer());
    let loadDone!: Promise<void>;
    await act(async () => {
      loadDone = result.current.load({
        projectId: 'projA',
        title: 't',
        folderId: null,
        sources: sourcesFor('projA', 'sA-'),
      });
      await Promise.resolve();
    });
    expect(result.current.state.loading?.nudge).toBe(0);

    await act(async () => {
      await result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(false);
    expect(result.current.state.loading?.nudge).toBe(1);

    await act(async () => {
      await result.current.togglePlay();
    });
    expect(result.current.state.loading?.nudge).toBe(2);
    expect(result.current.state.isPlaying).toBe(false);

    // Clean up the gate so the load settles.
    await act(async () => {
      release('projA');
      await loadDone;
    });
  });

  it('preserves a mute toggled during loading when the decode completes', async () => {
    gate('projA');
    const { result } = renderHook(() => usePlayer());
    let loadDone!: Promise<void>;
    await act(async () => {
      loadDone = result.current.load({
        projectId: 'projA',
        title: 't',
        folderId: null,
        sources: sourcesFor('projA', 'sA-'),
      });
      await Promise.resolve();
    });

    // Mute the first stem while its audio is still downloading.
    act(() => {
      result.current.toggleMute(0);
    });
    expect(result.current.state.stems[0].userMuted).toBe(true);

    // The buffer-merge at HEADS_READY must not clobber that user choice.
    await act(async () => {
      release('projA');
      await loadDone;
    });
    expect(result.current.state.stems[0].userMuted).toBe(true);
    expect(result.current.state.stems[1].userMuted).toBe(false);
    expect(result.current.state.stems[0].audioBuffer).not.toBeNull();
  });

  it('ignores a superseded load whose decode finishes after the user switched projects', async () => {
    gate('projA');
    gate('projB');
    const { result } = renderHook(() => usePlayer());

    // Open project A (slow — decode gated).
    let doneA!: Promise<void>;
    await act(async () => {
      doneA = result.current.load({
        projectId: 'projA',
        title: 'A',
        folderId: null,
        sources: sourcesFor('projA', 'sA-'),
      });
      await Promise.resolve();
    });
    expect(result.current.state.projectId).toBe('projA');

    // Switch to project B before A's audio arrives.
    let doneB!: Promise<void>;
    await act(async () => {
      doneB = result.current.load({
        projectId: 'projB',
        title: 'B',
        folderId: null,
        sources: sourcesFor('projB', 'sB-'),
      });
      await Promise.resolve();
    });
    expect(result.current.state.projectId).toBe('projB');

    // B finishes first and loads cleanly.
    await act(async () => {
      release('projB');
      await doneB;
    });
    expect(result.current.state.projectId).toBe('projB');
    expect(result.current.state.loading).toBeNull();
    expect(result.current.state.stems.map((s) => s.serverId)).toEqual(['sB-0', 'sB-1']);

    // A's decode lands late (full-file fallback path). Its stale HEADS_READY
    // must NOT overwrite B's stems, project metadata, or loading state.
    await act(async () => {
      release('projA');
      await doneA;
    });
    expect(result.current.state.projectId).toBe('projB');
    expect(result.current.state.stems.map((s) => s.serverId)).toEqual(['sB-0', 'sB-1']);
    expect(result.current.state.loading).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Head-start MP3 loading + segment scheduling.
//
// A stem becomes playable from its first ~20s segment ("head") before the rest
// of the file downloads. MP3 stems play from per-stem decoded segments
// (segmentsRef) rather than a single audioBuffer; non-MP3 (WAV) stems keep the
// existing full-file decode path.
//
// Harness shape:
// - fetch is routed by the presence of a Range header. A Range request resolves
//   via fetchSegmentBytes: it must expose `arrayBuffer()` AND a `headers.get`
//   that returns a `content-range` carrying the total file size. A non-Range
//   request is the full-file decode path (decodeStem): `arrayBuffer()` only.
// - decodeSegment decodes inside an OfflineAudioContext we stub to a fake buffer
//   of a fixed per-segment duration, so segment timing is deterministic.
// - createBufferSource start() calls are counted on the captured AudioContext so
//   we can assert a segment actually got scheduled.
// ---------------------------------------------------------------------------
describe('usePlayer — head-start MP3 loading', () => {
  // One 64 kbps / 44.1 kHz MPEG-1 L3 frame is 208 bytes; the header
  // 0xff 0xfb 0x50 0x00 is what isMp3()/the frame parser recognize.
  const FRAME = 208;
  function mp3Bytes(frames: number): Uint8Array {
    const out = new Uint8Array(frames * FRAME);
    for (let k = 0; k < frames; k++) {
      const i = k * FRAME;
      out[i] = 0xff;
      out[i + 1] = 0xfb;
      out[i + 2] = 0x50;
      out[i + 3] = 0x00;
    }
    return out;
  }
  // A RIFF/WAVE header — isMp3() returns false, so the stem takes the full-file
  // decode path.
  function wavBytes(): Uint8Array {
    return new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
  }

  // Each decodeSegment call yields a buffer of this duration. With a 2-segment
  // plan over a 40 s stem, segment 0 spans [0, SEG_SEC).
  const SEG_SEC = 20;

  // Stub OfflineAudioContext so decodeSegment returns a deterministic buffer.
  // It must implement decodeAudioData (-> a fake buffer) and createBuffer (for
  // the non-first lead-in trim path; our tests use leadInSec via real frames so
  // the trim runs, but we return the same shape).
  function installOfflineAudioContext() {
    const fakeBuf = (duration: number) => ({
      duration,
      length: Math.round(duration * 44100),
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(Math.round(duration * 44100)),
    });
    class FakeOfflineAudioContext {
      decodeAudioData() {
        return Promise.resolve(fakeBuf(SEG_SEC));
      }
      createBuffer(_ch: number, length: number) {
        return fakeBuf(length / 44100);
      }
    }
    vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
    vi.stubGlobal('webkitOfflineAudioContext', FakeOfflineAudioContext);
  }

  // Build a Range-aware fetch mock. `bytesFor(url)` returns the full byte array
  // for a stem; the mock slices it per Range request and reports the total via
  // content-range. `onRangeFetch` lets a test observe/gate fill requests.
  function installFetch(opts: {
    bytesFor: (url: string) => Uint8Array;
    onRangeFetch?: (url: string, start: number, endInclusive: number) => Promise<void> | void;
  }) {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string, init?: RequestInit) => {
        const all = opts.bytesFor(url);
        const range = (init?.headers as Record<string, string> | undefined)?.Range;
        if (range) {
          const m = /bytes=(\d+)-(\d+)/.exec(range)!;
          const start = Number(m[1]);
          const endInclusive = Number(m[2]);
          if (opts.onRangeFetch) await opts.onRangeFetch(url, start, endInclusive);
          const slice = all.subarray(start, Math.min(endInclusive + 1, all.length));
          return {
            ok: true,
            status: 206,
            headers: {
              get: (n: string) =>
                n.toLowerCase() === 'content-range'
                  ? `bytes ${start}-${endInclusive}/${all.length}`
                  : null,
            },
            arrayBuffer: async () => slice.slice().buffer,
          };
        }
        // Non-Range (full-file decode path / decodeStem).
        return {
          ok: true,
          headers: { get: () => null },
          arrayBuffer: async () => all.slice().buffer,
        };
      },
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal('AudioContext', CapturingAudioContext);
    vi.stubGlobal('webkitAudioContext', CapturingAudioContext);
    CapturingAudioContext.last = null;
    installOfflineAudioContext();
  });

  afterEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('webkitAudioContext', FakeAudioContext);
    vi.unstubAllGlobals();
    // Re-stub the defaults the other describe blocks rely on.
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('webkitAudioContext', FakeAudioContext);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
    );
  });

  function mp3Source(name: string, idPrefix: string, durationMs: number) {
    return { name, src: `https://example.test/${name}`, serverId: `${idPrefix}0`, durationMs };
  }

  it('becomes playable after the head segment, before the full download finishes', async () => {
    // 40 s stem -> 2 segments. Gate segment-1 fetches so the background fill is
    // demonstrably NOT done when we assert play works.
    const total = mp3Bytes(40); // 8320 bytes; plan[0].byteEnd = floor(8320/2) = 4160
    let segOneFetches = 0;
    let releaseFill!: () => void;
    const fillGate = new Promise<void>((res) => {
      releaseFill = res;
    });
    installFetch({
      bytesFor: () => total,
      onRangeFetch: async (_url, start) => {
        // start 0 is the head probe / segment 0; anything past it is the fill.
        if (start > 0) {
          segOneFetches++;
          await fillGate;
        }
      },
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [mp3Source('drums.mp3', 'm-', 40_000)],
      });
    });

    // HEADS_READY fired: loading cleared, head decoded, no full audioBuffer
    // (MP3 stems play from segments).
    expect(result.current.state.loading).toBeNull();
    expect(result.current.state.stems).toHaveLength(1);
    expect(result.current.state.stems[0].audioBuffer).toBeNull();
    // The background fill has reached (and is blocked on) the second segment.
    expect(segOneFetches).toBeGreaterThan(0);

    // Play works off the head segment alone.
    await act(async () => {
      result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(true);

    // Let the gated fill drain so the test exits cleanly.
    await act(async () => {
      releaseFill();
      await Promise.resolve();
    });
  });

  it('schedules a late-arriving next segment while playing', async () => {
    const total = mp3Bytes(40); // 2 segments
    let releaseFill!: () => void;
    const fillGate = new Promise<void>((res) => {
      releaseFill = res;
    });
    let gateArmed = true;
    installFetch({
      bytesFor: () => total,
      onRangeFetch: async (_url, start) => {
        if (start > 0 && gateArmed) await fillGate;
      },
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [mp3Source('drums.mp3', 'm-', 40_000)],
      });
    });

    // Start playback with only segment 0 decoded.
    await act(async () => {
      result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(true);

    const ctx = CapturingAudioContext.last!;
    // Reset after the initial play scheduled segment 0.
    ctx.startCallCount = 0;

    // Release the gate: segment 1 fetches + decodes and, because we're playing,
    // gets scheduled via scheduleDecodedSegment -> createBufferSource().start().
    gateArmed = false;
    await act(async () => {
      releaseFill();
      // Two awaited hops inside fillStem (fetch, decode) before scheduling.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ctx.startCallCount).toBeGreaterThan(0);
  });

  it('seek into an already-decoded later segment schedules that segment', async () => {
    // 60 s stem -> 3 segments. Use a realistically-sized file (~8000 B/s, like a
    // 64 kbps re-encode) so the 2048 B lead-in trims a negligible slice and the
    // gapless segment times stay close to [0,20],[20,40],[40,60]. A tiny
    // synthetic file would make the lead-in dominate and shift segment 2 out of
    // the seek target's range.
    const total = mp3Bytes(2308); // ~480 KB ≈ 8000 B/s over 60 s
    installFetch({ bytesFor: () => total });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [mp3Source('drums.mp3', 'm-', 60_000)],
      });
    });
    // Let the background fill finish decoding segments 1 and 2 (a real
    // macrotask flush — the fill chains fetch+decode awaits per segment).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    await act(async () => {
      result.current.togglePlay();
    });
    const ctx = CapturingAudioContext.last!;
    // togglePlay scheduled all three decoded segments; reset so the assertion
    // below reflects only the post-seek scheduling.
    expect(ctx.startCallCount).toBe(3);
    ctx.startCallCount = 0;

    // currentTime updates synchronously on seek (UI responsiveness), before the
    // coalesced audio reschedule.
    act(() => {
      result.current.seek(45);
    });
    expect(result.current.currentTime).toBe(45);

    // Flush the coalesced reschedule rAF: startSourcesAt(45) schedules only the
    // segment(s) covering 45 onward. Segments 0 ([0,20]) and 1 ([20,~40]) end
    // before 45 and are skipped; segment 2 ([~40,~60]) covers 45 and is
    // scheduled — exactly one source.
    act(() => {
      flushRaf();
    });
    expect(ctx.startCallCount).toBe(1);
  });

  it('non-MP3 (WAV) stem uses the full-file decode path, not segments', async () => {
    // Probe returns RIFF/WAVE bytes -> isMp3 false -> full-file decode via
    // decodeStem, which uses the live AudioContext.decodeAudioData (duration 60).
    installFetch({ bytesFor: () => wavBytes() });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'wp',
        title: 't',
        folderId: null,
        sources: [mp3Source('vox.wav', 'w-', 30_000)],
      });
    });

    expect(result.current.state.loading).toBeNull();
    // Full-file path: audioBuffer populated, duration from decodeAudioData (60).
    expect(result.current.state.stems[0].audioBuffer).not.toBeNull();
    expect(result.current.state.duration).toBe(60);

    // Play schedules exactly one source (the single buffer).
    await act(async () => {
      result.current.togglePlay();
    });
    const ctx = CapturingAudioContext.last!;
    expect(result.current.state.isPlaying).toBe(true);
    expect(ctx.startCallCount).toBe(1);
  });

  it('reconciles duration to summed segment durations after fill', async () => {
    // metaDuration 60 -> planSegments yields 3 segments. We force each decoded
    // segment to 19 s (sum = 57), DIFFERENT from the 60 s server estimate, so
    // the test proves the fill-complete handler reconciles state.duration to the
    // summed decoded durations rather than leaving the metaDuration estimate.
    // A custom OfflineAudioContext returns a fixed-duration buffer for both the
    // raw decode AND the lead-in-trim createBuffer path, so trimming non-first
    // segments still yields exactly 19 s regardless of the lead-in bytes.
    const SEG = 19;
    const fixedBuf = (duration: number) => ({
      duration,
      length: Math.round(duration * 44100),
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(Math.round(duration * 44100)),
    });
    class FixedOfflineAudioContext {
      decodeAudioData() {
        return Promise.resolve(fixedBuf(SEG));
      }
      // Ignore the requested length: a trimmed (non-first) segment must still
      // report 19 s so all three segments sum to the asserted 57 s.
      createBuffer() {
        return fixedBuf(SEG);
      }
    }
    vi.stubGlobal('OfflineAudioContext', FixedOfflineAudioContext);
    vi.stubGlobal('webkitOfflineAudioContext', FixedOfflineAudioContext);

    const total = mp3Bytes(2308); // ~480 KB over 60 s -> 3 segments
    installFetch({ bytesFor: () => total });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [mp3Source('drums.mp3', 'm-', 60_000)],
      });
    });

    // Drain the background fill (chained fetch+decode awaits per segment) so the
    // fill-complete handler runs and dispatches SET_DURATION. (act() flushes the
    // ungated fill eagerly, so the reconcile may already have run by the time
    // load() resolves; this extra flush makes the test robust regardless.)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 3 segments x 19 s = 57 s — the summed decoded durations supersede the
    // 60 s server metaDuration estimate that initial layout used.
    expect(result.current.state.duration).toBe(57);
  });

  it('removeStem prunes its segmentsRef entry', async () => {
    // Two MP3 stems, fill fully drained, then remove the first stem. After
    // removal, playing must schedule sources ONLY for the surviving stem — if
    // the removed stem's segmentsRef entry leaked, its segments would still be
    // scheduled. With 2 segments per 40 s stem, the survivor schedules 2.
    const total = mp3Bytes(40); // 2 segments per stem
    installFetch({ bytesFor: () => total });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [
          mp3Source('drums.mp3', 'a-', 40_000),
          { name: 'bass.mp3', src: 'https://example.test/bass.mp3', serverId: 'b-0', durationMs: 40_000 },
        ],
      });
    });
    // Let both stems' fills complete so each has 2 decoded segments.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.state.stems).toHaveLength(2);

    // Remove the first stem while paused.
    act(() => {
      result.current.removeStem('a-0');
    });
    expect(result.current.state.stems).toHaveLength(1);
    expect(result.current.state.stems[0].serverId).toBe('b-0');

    // Play: only the surviving stem's 2 segments should schedule. If the removed
    // stem's segmentsRef entry had leaked, we'd see its segments scheduled too.
    const ctx = CapturingAudioContext.last!;
    ctx.startCallCount = 0;
    await act(async () => {
      result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(true);
    expect(ctx.startCallCount).toBe(2);
  });

  it('a superseded background fill does not push segments or schedule for the current project', async () => {
    // Load project A with its fill gated mid-flight, start a new load() for
    // project B, then release A's gate. A's late segments must NOT push into
    // segmentsRef (its entry was cleared by B's load) and must NOT schedule
    // sources for B. We assert by counting B's scheduled sources when playing:
    // exactly B's own segments, with no extra sources from A's late arrivals.
    const total = mp3Bytes(40); // 2 segments per stem
    let releaseFillA!: () => void;
    const fillGateA = new Promise<void>((res) => {
      releaseFillA = res;
    });
    installFetch({
      bytesFor: () => total,
      onRangeFetch: async (url, start) => {
        // Gate only project A's background fill (segment 1+), not B's.
        if (start > 0 && url.includes('/projA/')) await fillGateA;
      },
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'projA',
        title: 'A',
        folderId: null,
        sources: [{ name: 'd.mp3', src: 'https://example.test/projA/d.mp3', serverId: 'sA-0', durationMs: 40_000 }],
      });
    });
    expect(result.current.state.projectId).toBe('projA');

    // Switch to B (ungated) — its load() bumps loadGenRef and clears segmentsRef.
    await act(async () => {
      await result.current.load({
        projectId: 'projB',
        title: 'B',
        folderId: null,
        sources: [{ name: 'd.mp3', src: 'https://example.test/projB/d.mp3', serverId: 'sB-0', durationMs: 40_000 }],
      });
    });
    // Drain B's fill so it has both segments.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.state.projectId).toBe('projB');
    expect(result.current.state.stems.map((s) => s.serverId)).toEqual(['sB-0']);

    // Now release A's stale fill. The gen guard must keep its late segment from
    // pushing into the (B-owned) segmentsRef or scheduling onto B's graph.
    await act(async () => {
      releaseFillA();
      await new Promise((r) => setTimeout(r, 0));
    });

    // B is intact and plays exactly its own 2 segments — A contributed nothing.
    const ctx = CapturingAudioContext.last!;
    ctx.startCallCount = 0;
    await act(async () => {
      result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(true);
    expect(result.current.state.projectId).toBe('projB');
    expect(ctx.startCallCount).toBe(2);
  });

  it('a per-segment fill failure stops that stem at the last good segment without affecting others', async () => {
    // Two MP3 stems. Stem "a" decodes fine; stem "b"'s SECOND segment fetch
    // rejects mid-fill. That stem's fill must stop at segment 0 (1 segment),
    // while stem "a" fills fully (2 segments) and playback keeps working.
    const total = mp3Bytes(40); // 2 segments per stem
    installFetch({
      bytesFor: () => total,
      onRangeFetch: async (url, start) => {
        // Reject only stem b's fill (segment 1+); the head probe (start 0) is fine.
        if (start > 0 && url.includes('bass.mp3')) {
          throw new Error('simulated segment fetch failure');
        }
      },
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [
          mp3Source('drums.mp3', 'a-', 40_000),
          { name: 'bass.mp3', src: 'https://example.test/bass.mp3', serverId: 'b-0', durationMs: 40_000 },
        ],
      });
    });
    // Drain fills: stem a -> 2 segments, stem b stops at 1 (segment-1 fetch rejects).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Player is healthy and both stems are present.
    expect(result.current.state.stems).toHaveLength(2);

    // Play: stem a schedules 2 segments, stem b schedules its 1 good segment = 3.
    // (No unhandled rejection — the fill swallows the error and stops the stem.)
    const ctx = CapturingAudioContext.last!;
    ctx.startCallCount = 0;
    await act(async () => {
      result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(true);
    expect(ctx.startCallCount).toBe(3);
  });

  it('mixed MP3 + WAV project schedules segment sources and one full-file source', async () => {
    // One MP3 stem (segment path, 2 segments over 40 s) and one WAV stem
    // (full-file decode -> single buffer). Playing must schedule both branches
    // of startSourcesAt: 2 segment sources + exactly 1 WAV buffer source = 3.
    const mp3Total = mp3Bytes(40);
    installFetch({
      bytesFor: (url) => (url.includes('vox.wav') ? wavBytes() : mp3Total),
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mix',
        title: 't',
        folderId: null,
        sources: [
          mp3Source('drums.mp3', 'm-', 40_000),
          { name: 'vox.wav', src: 'https://example.test/vox.wav', serverId: 'w-0', durationMs: 40_000 },
        ],
      });
    });
    // Drain the MP3 fill so its second segment decodes.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.state.stems).toHaveLength(2);
    // The WAV stem decoded to a full buffer; the MP3 stem did not.
    const wav = result.current.state.stems.find((s) => s.serverId === 'w-0')!;
    const mp3 = result.current.state.stems.find((s) => s.serverId === 'm-0')!;
    expect(wav.audioBuffer).not.toBeNull();
    expect(mp3.audioBuffer).toBeNull();

    const ctx = CapturingAudioContext.last!;
    ctx.startCallCount = 0;
    await act(async () => {
      result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(true);
    // 2 MP3 segment sources + 1 WAV buffer source.
    expect(ctx.startCallCount).toBe(3);
  });

  it('linear playback schedules segment k at the running actual-duration sum (anchor 0)', async () => {
    // Three segments with DISTINCT decoded durations 19.9 / 19.8 / 19.95. Under
    // the session-anchor model with anchor j=0, segment 0 sits at 0, and each
    // later contiguous index accumulates the ACTUAL decoded durations of its
    // predecessors. So segment 1 starts at 19.9 and segment 2 at 19.9+19.8=39.7
    // (in play position). startSourcesAt sets startWhen = ctx.currentTime + 0.05
    // and schedules future segments at startWhen + (startSec - offset); with
    // offset 0 that is startWhen + startSec. We capture each createBufferSource
    // start()'s `when` arg and assert segments 1 and 2 land at startWhen+19.9 and
    // startWhen+39.7. This pins linear timing as actual-from-0 (Phase 1 parity).
    const DURATIONS = [19.9, 19.8, 19.95];
    let decodeCall = 0;
    const fakeBuf = (duration: number) => ({
      duration,
      length: Math.round(duration * 44100),
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(Math.round(duration * 44100)),
    });
    class VaryingOfflineAudioContext {
      decodeAudioData() {
        // Segment k is decoded in plan order: head (k=0) first, then fill 1,2.
        const d = DURATIONS[Math.min(decodeCall, DURATIONS.length - 1)];
        decodeCall++;
        return Promise.resolve(fakeBuf(d));
      }
      // The lead-in trim path (non-first segments) must preserve the per-segment
      // duration, so return the same buffer the decode produced for this index.
      createBuffer() {
        const d = DURATIONS[Math.min(decodeCall - 1, DURATIONS.length - 1)];
        return fakeBuf(d);
      }
    }
    vi.stubGlobal('OfflineAudioContext', VaryingOfflineAudioContext);
    vi.stubGlobal('webkitOfflineAudioContext', VaryingOfflineAudioContext);

    const total = mp3Bytes(2308); // ~480 KB over 60 s -> 3 segments
    installFetch({ bytesFor: () => total });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [mp3Source('drums.mp3', 'm-', 60_000)],
      });
    });
    // Drain the background fill so all 3 segments are decoded.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const ctx = CapturingAudioContext.last!;
    // Capture every start() `when` argument. createBufferSource is overridden on
    // the instance so we observe the scheduling from the upcoming togglePlay.
    const whenArgs: number[] = [];
    const origCreate = ctx.createBufferSource.bind(ctx);
    ctx.createBufferSource = () => {
      const src = origCreate();
      const origStart = src.start.bind(src);
      src.start = (when?: number, offset?: number) => {
        whenArgs.push(when ?? 0);
        return origStart(when, offset);
      };
      return src;
    };

    await act(async () => {
      result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(true);

    // startWhen = ctx.currentTime (0) + 0.05.
    const startWhen = 0.05;
    // Three segments scheduled, in index order.
    expect(whenArgs).toHaveLength(3);
    // Segment 0 starts now (straddles playhead at 0): when = ctx.currentTime +
    // INSIDE_LOOKAHEAD (0.02), not the future-segment formula. Assert only that
    // it's small/non-negative; the load-bearing claim is the seam timing below.
    expect(whenArgs[0]).toBeGreaterThanOrEqual(0);
    expect(whenArgs[0]).toBeLessThan(1);
    // Segments 1 and 2 are future segments: when = startWhen + startSec.
    expect(whenArgs[1]).toBeCloseTo(startWhen + 19.9, 5);
    expect(whenArgs[2]).toBeCloseTo(startWhen + 39.7, 5);
  });

  it('loop wrap reschedules only the segments covering the loop window', async () => {
    // A segmented MP3 stem (3 segments over 60 s) with a loop region inside a
    // single segment. Driving the rAF clock past loop.end triggers a wrap, which
    // stopSources + startSourcesAt(loop.start) — rescheduling only the
    // segment(s) covering [loop.start, ...). A loop fully inside segment 2
    // ([~40,~60]) reschedules exactly that one segment.
    const total = mp3Bytes(2308); // ~480 KB over 60 s -> 3 segments
    installFetch({ bytesFor: () => total });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [mp3Source('drums.mp3', 'm-', 60_000)],
      });
    });
    // Drain the fill so all 3 segments are decoded.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    await act(async () => {
      result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(true);

    // Loop [50, 55] sits inside segment 2 ([~40, ~60]).
    act(() => {
      result.current.setLoop(50, 55);
    });

    const ctx = CapturingAudioContext.last!;
    // Reset after the initial play scheduled all decoded segments.
    ctx.startCallCount = 0;

    // playStartCtxTimeRef = 0.05; advance ctx.currentTime so computeCurrentTime
    // crosses loop.end (55) in one tick: ctx.currentTime - 0.05 >= 54.995 (LOOP_TAIL).
    ctx.currentTime = 56;
    act(() => {
      flushRaf();
    });

    // Wrapped to loop.start.
    expect(result.current.currentTime).toBe(50);
    expect(result.current.state.isPlaying).toBe(true);
    // Only segment 2 covers offset 50 -> exactly one rescheduled source.
    // Segments 0 ([0,~20]) and 1 ([~20,~40]) end before 50 and are skipped.
    expect(ctx.startCallCount).toBe(1);
  });

  it('seek repositions the fill cursor to the segment under the playhead and fetches it next', async () => {
    // 120 s stem -> 6 plan segments. Gate every background-fill fetch (start>0)
    // so the loop is parked on segment 1 (the first fill index) and NOTHING past
    // it has been requested. While that fetch is in flight we seek to 70 s
    // (j = floor(70/20) = 3), which repositions the cursor. Releasing the gate
    // lets the parked segment-1 fetch complete; the loop's NEXT iteration reads
    // the moved cursor and fetches plan[3] — not plan[2] as a fixed 1,2,3 crawl
    // would. We assert on the ORDER of fetchStart values requested.
    const total = mp3Bytes(2308 * 2); // ~960 KB over 120 s -> 6 segments
    const plan = planSegments(total.length, 120);
    expect(plan).toHaveLength(6);

    const fetchStarts: number[] = [];
    let releaseFirstFill!: () => void;
    const firstFillGate = new Promise<void>((res) => {
      releaseFirstFill = res;
    });
    let gatedOnce = false;
    installFetch({
      bytesFor: () => total,
      onRangeFetch: async (_url, start) => {
        if (start > 0) {
          fetchStarts.push(start);
          // Park ONLY the first fill fetch; once released the loop runs free.
          if (!gatedOnce) {
            gatedOnce = true;
            await firstFillGate;
          }
        }
      },
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [mp3Source('drums.mp3', 'm-', 120_000)],
      });
    });

    // Head is ready; the fill has issued (and is parked on) segment 1's fetch.
    expect(result.current.state.loading).toBeNull();
    expect(fetchStarts).toEqual([plan[1].fetchStart]);

    // Start playback off the head, then seek to 70 s -> j=3.
    await act(async () => {
      result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(true);
    act(() => {
      result.current.seek(70);
    });
    expect(result.current.currentTime).toBe(70);

    // Release the parked segment-1 fetch and drain the now-free fill loop.
    await act(async () => {
      releaseFirstFill();
      await new Promise((r) => setTimeout(r, 0));
    });

    // The NEXT new fetch after the (in-flight) segment 1 is plan[3] — the seek
    // target — proving the cursor moved. A fixed 1,2,3 crawl would fetch plan[2].
    expect(fetchStarts[0]).toBe(plan[1].fetchStart);
    expect(fetchStarts[1]).toBe(plan[3].fetchStart);
  });

  it('fill backfills earlier gaps after reaching the end, and terminates', async () => {
    // 120 s stem -> 6 plan segments. Seek to j=4 BEFORE the fill begins (gate the
    // first fill fetch), so when the loop runs it starts at cursor 4. It should
    // fetch 4,5 forward, then backfill 1,2,3, then terminate (segment 0 is the
    // decoded head). No duplicate fetch, no hang.
    const total = mp3Bytes(2308 * 2); // 6 segments
    const plan = planSegments(total.length, 120);
    expect(plan).toHaveLength(6);
    // Map a requested fetchStart back to its plan index for a readable assertion.
    const indexOfStart = (start: number) =>
      plan.findIndex((p) => p.fetchStart === start);

    const fetchedIndices: number[] = [];
    let releaseFirstFill!: () => void;
    const firstFillGate = new Promise<void>((res) => {
      releaseFirstFill = res;
    });
    let gatedOnce = false;
    installFetch({
      bytesFor: () => total,
      onRangeFetch: async (_url, start) => {
        if (start > 0) {
          fetchedIndices.push(indexOfStart(start));
          if (!gatedOnce) {
            gatedOnce = true;
            await firstFillGate;
          }
        }
      },
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [mp3Source('drums.mp3', 'm-', 120_000)],
      });
    });

    // Play, then seek to j=4 while the first fill fetch is parked.
    await act(async () => {
      result.current.togglePlay();
    });
    act(() => {
      result.current.seek(4 * 20); // 80 s -> j=4
    });

    // Release the parked fetch and let the loop run to completion.
    await act(async () => {
      releaseFirstFill();
      await new Promise((r) => setTimeout(r, 0));
    });

    // The first parked fetch was segment 1 (issued before the seek moved the
    // cursor); every subsequent fetch follows the moved cursor: 4,5 forward then
    // 2,3 backfill (1 already fetched). All five non-head indices, each once.
    expect(fetchedIndices[0]).toBe(1);
    const afterPark = fetchedIndices.slice(1);
    expect(afterPark).toEqual([4, 5, 2, 3]);
    // No duplicate fetch across the whole run.
    expect(new Set(fetchedIndices).size).toBe(fetchedIndices.length);
    // Loop terminated: all six segments (0 head + 1..5 fetched) accounted for,
    // so nextFillIndex returned null and the fill resolved without hanging.
    expect(new Set([0, ...fetchedIndices])).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });

  // flushRaf / rafQueue mirror the Phase A harness so seek's coalesced rAF and
  // the rAF tick can be driven deterministically here too.
  let rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  let rafIdCounter = 0;
  function flushRaf(): void {
    const batch = rafQueue.splice(0);
    for (const entry of batch) entry.cb(0);
  }
  beforeEach(() => {
    rafQueue = [];
    rafIdCounter = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = ++rafIdCounter;
      rafQueue.push({ id, cb });
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      const idx = rafQueue.findIndex((e) => e.id === id);
      if (idx >= 0) rafQueue.splice(idx, 1);
    });
  });
});

// ---------------------------------------------------------------------------
// Stall / resume buffering engine (Task 4).
//
// The playhead is driven by the wall clock, independent of whether audio is
// actually scheduled. Playing into an undecoded region (seek-ahead, or the
// background fill falling behind) must STALL — freeze the cursor, stop the
// silent sources, and show buffering — then auto-resume the moment the covering
// segment arrives.
//
// Harness: the Range-aware fetch + OfflineAudioContext stubs from the head-start
// block (segmented MP3 stems land in segmentsRef), a CapturingAudioContext so we
// can advance ctx.currentTime and count createBufferSource().start() calls, and
// a manual rAF queue so the tick runs one frame at a time via flushRaf().
// ---------------------------------------------------------------------------
describe('usePlayer — stall / resume buffering', () => {
  const FRAME = 208;
  function mp3Bytes(frames: number): Uint8Array {
    const out = new Uint8Array(frames * FRAME);
    for (let k = 0; k < frames; k++) {
      const i = k * FRAME;
      out[i] = 0xff;
      out[i + 1] = 0xfb;
      out[i + 2] = 0x50;
      out[i + 3] = 0x00;
    }
    return out;
  }

  // Each decoded segment yields a deterministic ~20 s buffer (close enough to
  // the nominal SEGMENT_SEC that gapless seam drift stays sub-second for the
  // realistically-sized files below).
  function installOfflineAudioContext(segSec: number) {
    const fakeBuf = (duration: number) => ({
      duration,
      length: Math.round(duration * 44100),
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(Math.round(duration * 44100)),
    });
    class FakeOfflineAudioContext {
      decodeAudioData() {
        return Promise.resolve(fakeBuf(segSec));
      }
      createBuffer(_ch: number, length: number) {
        return fakeBuf(length / 44100);
      }
    }
    vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
    vi.stubGlobal('webkitOfflineAudioContext', FakeOfflineAudioContext);
  }

  function installFetch(opts: {
    bytesFor: (url: string) => Uint8Array;
    onRangeFetch?: (url: string, start: number, endInclusive: number) => Promise<void> | void;
  }) {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string, init?: RequestInit) => {
        const all = opts.bytesFor(url);
        const range = (init?.headers as Record<string, string> | undefined)?.Range;
        if (range) {
          const m = /bytes=(\d+)-(\d+)/.exec(range)!;
          const start = Number(m[1]);
          const endInclusive = Number(m[2]);
          if (opts.onRangeFetch) await opts.onRangeFetch(url, start, endInclusive);
          const slice = all.subarray(start, Math.min(endInclusive + 1, all.length));
          return {
            ok: true,
            status: 206,
            headers: {
              get: (n: string) =>
                n.toLowerCase() === 'content-range'
                  ? `bytes ${start}-${endInclusive}/${all.length}`
                  : null,
            },
            arrayBuffer: async () => slice.slice().buffer,
          };
        }
        return {
          ok: true,
          headers: { get: () => null },
          arrayBuffer: async () => all.slice().buffer,
        };
      },
    );
  }

  let rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  let rafIdCounter = 0;
  function flushRaf(): void {
    const batch = rafQueue.splice(0);
    for (const entry of batch) entry.cb(0);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    rafQueue = [];
    rafIdCounter = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = ++rafIdCounter;
      rafQueue.push({ id, cb });
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      const idx = rafQueue.findIndex((e) => e.id === id);
      if (idx >= 0) rafQueue.splice(idx, 1);
    });
    vi.stubGlobal('AudioContext', CapturingAudioContext);
    vi.stubGlobal('webkitAudioContext', CapturingAudioContext);
    CapturingAudioContext.last = null;
    installOfflineAudioContext(20);
  });

  afterEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('webkitAudioContext', FakeAudioContext);
    vi.unstubAllGlobals();
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('webkitAudioContext', FakeAudioContext);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
    );
  });

  function mp3Source(name: string, idPrefix: string, durationMs: number) {
    return { name, src: `https://example.test/${name}`, serverId: `${idPrefix}0`, durationMs };
  }

  it('seeking into an undecoded gap stalls: buffering true, cursor frozen, no sources scheduled', async () => {
    // 60 s stem -> 3 segments. Gate the background fill so only segment 0
    // ([0,~20]) is decoded; segments 1 and 2 stay undecoded.
    const total = mp3Bytes(2308);
    let releaseFill!: () => void;
    const fillGate = new Promise<void>((res) => {
      releaseFill = res;
    });
    installFetch({
      bytesFor: () => total,
      onRangeFetch: async (_url, start) => {
        if (start > 0) await fillGate;
      },
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [mp3Source('drums.mp3', 'm-', 60_000)],
      });
    });
    await act(async () => {
      result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(true);
    expect(result.current.state.buffering).toBe(false);

    const ctx = CapturingAudioContext.last!;
    ctx.startCallCount = 0;

    // Seek to 45 s — inside segment 2, which is NOT decoded. seek() must detect
    // the uncovered position synchronously and stall before any reschedule.
    act(() => {
      result.current.seek(45);
    });
    expect(result.current.state.buffering).toBe(true);
    expect(result.current.currentTime).toBe(45);

    // No new sources scheduled — the coalesced reschedule was short-circuited.
    act(() => {
      flushRaf();
    });
    expect(ctx.startCallCount).toBe(0);
    // Cursor stays frozen at the stall position across ticks.
    expect(result.current.currentTime).toBe(45);

    await act(async () => {
      releaseFill();
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it('resumes and schedules a source at stallPos when the covering segment arrives', async () => {
    // 60 s stem -> 3 segments. Gate the fill, seek into the undecoded segment 2
    // to stall, then release the gate so segments 1 and 2 decode; a rAF tick
    // detects coverage and resumes.
    const total = mp3Bytes(2308);
    let releaseFill!: () => void;
    const fillGate = new Promise<void>((res) => {
      releaseFill = res;
    });
    installFetch({
      bytesFor: () => total,
      onRangeFetch: async (_url, start) => {
        if (start > 0) await fillGate;
      },
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [mp3Source('drums.mp3', 'm-', 60_000)],
      });
    });
    await act(async () => {
      result.current.togglePlay();
    });

    act(() => {
      result.current.seek(45);
    });
    expect(result.current.state.buffering).toBe(true);

    const ctx = CapturingAudioContext.last!;
    ctx.startCallCount = 0;

    // Release the fill so segments 1 and 2 decode (segment 2 covers 45 s).
    await act(async () => {
      releaseFill();
      await new Promise((r) => setTimeout(r, 0));
    });

    // A tick now finds the position covered: clears buffering and reschedules.
    act(() => {
      flushRaf();
    });
    expect(result.current.state.buffering).toBe(false);
    expect(result.current.state.isPlaying).toBe(true);
    expect(ctx.startCallCount).toBeGreaterThan(0);
    // Cursor sits at the resumed position (the frozen stallPos), not 0.
    expect(result.current.currentTime).toBeCloseTo(45, 0);
  });

  it('resets lastTRef on resume so loop-wrap does not spuriously fire', async () => {
    // Stall at 45 s inside a loop region [40, 50]. On resume lastTRef must be
    // reset to the stall position (45) — if it were left at the pre-stall value
    // (~0), shouldLoopWrap would see a jump across loop.end and wrongly wrap.
    const total = mp3Bytes(2308);
    let releaseFill!: () => void;
    const fillGate = new Promise<void>((res) => {
      releaseFill = res;
    });
    installFetch({
      bytesFor: () => total,
      onRangeFetch: async (_url, start) => {
        if (start > 0) await fillGate;
      },
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [mp3Source('drums.mp3', 'm-', 60_000)],
      });
    });
    await act(async () => {
      result.current.togglePlay();
    });
    act(() => {
      result.current.setLoop(40, 50);
    });

    act(() => {
      result.current.seek(45);
    });
    expect(result.current.state.buffering).toBe(true);

    await act(async () => {
      releaseFill();
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => {
      flushRaf();
    });

    // Resumed at the stall position — NOT wrapped to loop.start (40).
    expect(result.current.state.buffering).toBe(false);
    expect(result.current.currentTime).toBeCloseTo(45, 0);
    expect(result.current.currentTime).not.toBe(40);
    expect(result.current.state.isPlaying).toBe(true);
  });

  it('linear underrun stalls at the frontier without firing end-of-song for a short stem', async () => {
    // 60 s stem -> 3 segments. Gate the fill so only segment 0 ([0,~20]) is
    // decoded, then advance the wall clock past the decoded frontier (into the
    // undecoded segment 1 region) WITHOUT reaching the end of the song. The tick
    // must stall at the frontier, not end playback.
    const total = mp3Bytes(2308);
    let releaseFill!: () => void;
    const fillGate = new Promise<void>((res) => {
      releaseFill = res;
    });
    installFetch({
      bytesFor: () => total,
      onRangeFetch: async (_url, start) => {
        if (start > 0) await fillGate;
      },
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [mp3Source('drums.mp3', 'm-', 60_000)],
      });
    });
    await act(async () => {
      result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(true);

    const ctx = CapturingAudioContext.last!;
    // Advance the wall clock to 30 s — past the decoded frontier (~20 s) but far
    // from the 60 s end. computeCurrentTime = 30 - 0.05.
    ctx.currentTime = 30;
    act(() => {
      flushRaf();
    });

    // Stalled at the frontier, NOT ended.
    expect(result.current.state.buffering).toBe(true);
    expect(result.current.state.isPlaying).toBe(true);
    expect(result.current.currentTime).toBeLessThan(60);

    await act(async () => {
      releaseFill();
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it('muting the unbuffered stem during a stall resumes playback', async () => {
    // Two MP3 stems. Stem b's fill is gated (only segment 0 decoded); stem a's
    // fill drains fully. Seek into segment 2: stem b is uncovered -> stall.
    // Muting stem b removes it from the coverage gate, so the next tick resumes
    // (stem a covers the position).
    const total = mp3Bytes(2308);
    let releaseFillB!: () => void;
    const fillGateB = new Promise<void>((res) => {
      releaseFillB = res;
    });
    installFetch({
      bytesFor: () => total,
      onRangeFetch: async (url, start) => {
        if (start > 0 && url.includes('bass.mp3')) await fillGateB;
      },
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [
          mp3Source('drums.mp3', 'a-', 60_000),
          { name: 'bass.mp3', src: 'https://example.test/bass.mp3', serverId: 'b-0', durationMs: 60_000 },
        ],
      });
    });
    // Let stem a's fill complete (stem b stays parked on segment 1).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      result.current.togglePlay();
    });

    act(() => {
      result.current.seek(45);
    });
    // Stem b doesn't cover 45 -> stall.
    expect(result.current.state.buffering).toBe(true);

    // Mute stem b. It's index 1.
    act(() => {
      result.current.toggleMute(1);
    });
    act(() => {
      flushRaf();
    });

    // With stem b muted it no longer gates; stem a covers 45 -> resumed.
    expect(result.current.state.buffering).toBe(false);
    expect(result.current.state.isPlaying).toBe(true);

    await act(async () => {
      releaseFillB();
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it('pause during a stall captures stallPos (not a moving wall-clock position) and clears buffering', async () => {
    const total = mp3Bytes(2308);
    let releaseFill!: () => void;
    const fillGate = new Promise<void>((res) => {
      releaseFill = res;
    });
    installFetch({
      bytesFor: () => total,
      onRangeFetch: async (_url, start) => {
        if (start > 0) await fillGate;
      },
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [mp3Source('drums.mp3', 'm-', 60_000)],
      });
    });
    await act(async () => {
      result.current.togglePlay();
    });

    act(() => {
      result.current.seek(45);
    });
    expect(result.current.state.buffering).toBe(true);

    const ctx = CapturingAudioContext.last!;
    // Advance the wall clock while stalled — computeCurrentTime must still report
    // the frozen stallPos (45), so pause() captures 45, not a moved position.
    ctx.currentTime = 55;
    act(() => {
      result.current.pause();
    });
    expect(result.current.state.isPlaying).toBe(false);
    expect(result.current.state.buffering).toBe(false);
    expect(result.current.currentTime).toBeCloseTo(45, 0);

    // Resuming play from the captured offset must begin at 45, not 55.
    await act(async () => {
      releaseFill();
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(true);
    expect(result.current.currentTime).toBeCloseTo(45, 0);
  });

  it('a fully-errored segment stem (no decoded segments) is excluded and does not stall the others', async () => {
    // Two MP3 stems. Stem b's segment-0 decode fails so it ends up with an empty
    // segmentsRef entry (kind: 'errored'); stem a decodes fully. Playing and
    // seeking anywhere stem a covers must NOT stall — the errored stem is
    // excluded from the coverage gate.
    const goodTotal = mp3Bytes(2308); // 3 segments, decodes fine
    installFetch({
      bytesFor: () => goodTotal,
      onRangeFetch: (url, start) => {
        // Fail every fetch for stem b so it never gets a decoded segment.
        if (url.includes('bass.mp3')) {
          throw new Error('simulated total failure');
        }
        void start;
      },
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [
          mp3Source('drums.mp3', 'a-', 60_000),
          { name: 'bass.mp3', src: 'https://example.test/bass.mp3', serverId: 'b-0', durationMs: 60_000 },
        ],
      });
    });
    // Drain: stem a fully decodes; stem b's head decode failed -> full-file
    // fallback also fails -> it has no usable buffer/segments.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(true);

    // Seek into segment 2 (covered by stem a). The errored stem b must not gate.
    act(() => {
      result.current.seek(45);
    });
    expect(result.current.state.buffering).toBe(false);
    expect(result.current.currentTime).toBe(45);

    act(() => {
      flushRaf();
    });
    expect(result.current.state.buffering).toBe(false);
    expect(result.current.state.isPlaying).toBe(true);
  });

  it('does not schedule audio during a stall when a stale coalesced seek rAF fires', async () => {
    // Repro for the critical bug: a COVERED seek queues a coalesced reschedule
    // rAF; a subsequent UNCOVERED seek enters buffering and returns early. When
    // the stale rAF fires it must NOT schedule sources at the old target — that
    // source would be orphaned by the buffering branch's startSourcesAt(stallPos)
    // (which resets sourcesRef without stopSources first) and play out of sync.
    const total = mp3Bytes(2308); // 60 s -> 3 segments
    let releaseFill!: () => void;
    const fillGate = new Promise<void>((res) => {
      releaseFill = res;
    });
    installFetch({
      bytesFor: () => total,
      onRangeFetch: async (_url, start) => {
        if (start > 0) await fillGate;
      },
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [mp3Source('drums.mp3', 'm-', 60_000)],
      });
    });
    await act(async () => {
      result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(true);
    expect(result.current.state.buffering).toBe(false);

    const ctx = CapturingAudioContext.last!;
    ctx.startCallCount = 0;

    // Seek to a COVERED point (5 s, inside decoded segment 0) — this queues the
    // coalesced reschedule rAF. Then, in the same synchronous batch, seek to an
    // UNCOVERED point (45 s, inside undecoded segment 2) — this enters buffering
    // and returns early WITHOUT running the queued rAF.
    act(() => {
      result.current.seek(5);
      result.current.seek(45);
    });
    expect(result.current.state.buffering).toBe(true);
    expect(result.current.currentTime).toBe(45);

    // The stall point: no sources scheduled yet from the seeks.
    const callsAtStall = ctx.startCallCount;

    // Flush the pending (now stale) coalesced rAF. The guard must bail because
    // buffering is true — so no sources get scheduled at the old 5 s target.
    act(() => {
      flushRaf();
    });
    expect(result.current.state.buffering).toBe(true);
    expect(ctx.startCallCount).toBe(callsAtStall);
    expect(result.current.currentTime).toBe(45);

    await act(async () => {
      releaseFill();
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it('togglePlay resuming into an unbuffered offset stalls then resumes', async () => {
    // Pause with the playhead parked at an offset the buffered frontier hasn't
    // reached, then play. togglePlay schedules nothing audible there, but the
    // stem has a segmentsRef entry so startSourcesAt reports ok (not "Playback
    // blocked"); the rAF tick then detects the uncovered offset and stalls.
    // Releasing the fill lets the covering segment arrive and playback resumes.
    const total = mp3Bytes(2308); // 60 s -> 3 segments
    let releaseFill!: () => void;
    const fillGate = new Promise<void>((res) => {
      releaseFill = res;
    });
    installFetch({
      bytesFor: () => total,
      onRangeFetch: async (_url, start) => {
        if (start > 0) await fillGate;
      },
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [mp3Source('drums.mp3', 'm-', 60_000)],
      });
    });

    // Park the paused offset at 45 s (inside the undecoded segment 2). seek()
    // while paused only moves the offset/cursor — no stall (nothing scheduled).
    act(() => {
      result.current.seek(45);
    });
    expect(result.current.state.isPlaying).toBe(false);
    expect(result.current.state.buffering).toBe(false);
    expect(result.current.currentTime).toBe(45);

    // Play from the unbuffered offset. Must NOT report "Playback blocked".
    await act(async () => {
      result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(true);
    expect(result.current.state.status).not.toMatch(/Playback blocked/);

    // The rAF tick detects the uncovered offset and stalls.
    act(() => {
      flushRaf();
    });
    expect(result.current.state.buffering).toBe(true);
    expect(result.current.currentTime).toBeCloseTo(45, 0);

    const ctx = CapturingAudioContext.last!;
    ctx.startCallCount = 0;

    // Release the fill: the covering segment decodes; the next tick resumes.
    await act(async () => {
      releaseFill();
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => {
      flushRaf();
    });
    expect(result.current.state.buffering).toBe(false);
    expect(result.current.state.isPlaying).toBe(true);
    expect(ctx.startCallCount).toBeGreaterThan(0);
    expect(result.current.currentTime).toBeCloseTo(45, 0);
  });

  it('a fill segment arriving during a stall does not schedule a dangling source', async () => {
    // Stall by seeking into segment 2 while segments 1 and 2 are gated. Release
    // ONLY segment 1's fetch (still leaving the seek target, segment 2, gated):
    // it decodes mid-stall and scheduleDecodedSegment runs. With the buffering
    // guard it must bail — no source scheduled against the stale pre-stall anchor
    // while buffering is true.
    const total = mp3Bytes(2308); // 60 s -> 3 segments
    let releaseSeg1!: () => void;
    const seg1Gate = new Promise<void>((res) => {
      releaseSeg1 = res;
    });
    let releaseSeg2!: () => void;
    const seg2Gate = new Promise<void>((res) => {
      releaseSeg2 = res;
    });
    installFetch({
      bytesFor: () => total,
      onRangeFetch: async (_url, start) => {
        // Segment boundaries are ~20 s of bytes apart. start>0 is segment 1's
        // fetchStart; the larger start is segment 2's. Gate them separately so
        // we can let segment 1 in while segment 2 (the seek target) stays out.
        if (start === 0) return;
        // The fill picks the seek target's segment (2) first after the seek
        // repositions the cursor, then backfills 1. Gate by which fetch it is.
        if (start >= total.length / 2) {
          await seg2Gate;
        } else {
          await seg1Gate;
        }
      },
    });

    const { result } = renderHook(() => usePlayer());
    await act(async () => {
      await result.current.load({
        projectId: 'mp',
        title: 't',
        folderId: null,
        sources: [mp3Source('drums.mp3', 'm-', 60_000)],
      });
    });
    await act(async () => {
      result.current.togglePlay();
    });
    expect(result.current.state.isPlaying).toBe(true);

    // Seek to 45 s (segment 2, gated) -> stall.
    act(() => {
      result.current.seek(45);
    });
    expect(result.current.state.buffering).toBe(true);

    const ctx = CapturingAudioContext.last!;
    ctx.startCallCount = 0;

    // Release segment 1 only. It decodes mid-stall; scheduleDecodedSegment runs
    // but must bail on buffering — no dangling source. Segment 2 stays gated, so
    // 45 s remains uncovered and we stay buffering.
    await act(async () => {
      releaseSeg1();
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => {
      flushRaf();
    });
    expect(result.current.state.buffering).toBe(true);
    expect(ctx.startCallCount).toBe(0);

    await act(async () => {
      releaseSeg2();
      await new Promise((r) => setTimeout(r, 0));
    });
  });
});
