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
import { describe, it, expect, beforeEach, vi } from 'vitest';

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
  decodeAudioData(_buf: ArrayBuffer): Promise<unknown> {
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
        driveFolderId: null,
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
        driveFolderId: 'drive-xyz',
        sources: makeSources('drums.mp3', 'bass.mp3'),
      });
    });
    expect(result.current.state.stems).toHaveLength(2);
    expect(result.current.state.projectId).toBe('proj-1');
    expect(result.current.state.title).toBe('My Song');
    expect(result.current.state.driveFolderId).toBe('drive-xyz');
    // FakeAudioContext.decodeAudioData returns duration=60.
    expect(result.current.state.duration).toBe(60);
    expect(result.current.state.stems[0].audioBuffer).not.toBeNull();
    expect(result.current.state.isPlaying).toBe(false);
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
