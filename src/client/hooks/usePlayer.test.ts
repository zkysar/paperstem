// First-pass tests for the usePlayer hook.
//
// usePlayer.ts is 726 lines and orchestrates Web Audio scheduling, decode,
// drift correction, seek coalescing, loop wrap, mute/solo, and per-track gain.
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
