import { describe, expect, it, vi } from 'vitest';
import { applyShareState } from './apply-share-state';
import type { ShareState } from './share-url';
import type { LoadedStem, PlayerState } from '../data/types';
import type { ViewportControls, ViewportState } from '../hooks/useViewport';

function makeViewport(over: Partial<ViewportState> = {}): ViewportControls {
  const state: ViewportState = {
    hZoom: 1,
    trackHeight: 44,
    scrollLeft: 0,
    followMode: 'smooth',
    followActive: true,
    stageWidth: 1000,
    railWidth: 200,
    ...over,
  };
  return {
    state,
    zoomH: vi.fn(),
    zoomHBy: vi.fn(),
    zoomV: vi.fn(),
    zoomVBy: vi.fn(),
    setScrollLeft: vi.fn(),
    fitToWindow: vi.fn(),
    setFollowActive: vi.fn(),
    setFollowMode: vi.fn(),
    setStageWidth: vi.fn(),
    setRailWidth: vi.fn(),
    setView: vi.fn(),
  };
}

function makeStem(over: Partial<LoadedStem>): LoadedStem {
  return {
    name: 'x.mp3',
    displayName: 'x',
    color: '#fff',
    audio: {} as HTMLAudioElement,
    userMuted: false,
    soloed: false,
    userVolume: 100,
    projectId: 'p',
    serverId: 'a',
    gain: null,
    peaks: null,
    ...over,
  };
}
function makePlayer(stems: LoadedStem[], duration = 60): PlayerState {
  return {
    projectId: 'p',
    title: 't',
    folderId: null,
    stems,
    duration,
    referenceIdx: 0,
    isPlaying: false,
    loop: null,
    status: '',
    loading: null,
    waveformNormalization: 'per-track',
    masterVolume: 100,
  };
}

describe('applyShareState', () => {
  it('applies time, loop, mix, master, comment in order', () => {
    const calls: string[] = [];
    const stems = [makeStem({ serverId: 'a' }), makeStem({ serverId: 'b' })];
    const player = {
      state: makePlayer(stems),
      setLoop: vi.fn((s, e) => calls.push(`loop(${s},${e})`)),
      setLoopEnabled: vi.fn((b) => calls.push(`loopEnabled(${b})`)),
      setVolume: vi.fn((i, v) => calls.push(`vol(${i},${v})`)),
      toggleMute: vi.fn((i) => calls.push(`mute(${i})`)),
      toggleSolo: vi.fn((i) => calls.push(`solo(${i})`)),
      setMasterVolume: vi.fn((v) => calls.push(`master(${v})`)),
      seek: vi.fn((t) => calls.push(`seek(${t})`)),
    };
    const onFocusComment = vi.fn();
    const onOpenDrawer = vi.fn();

    const state: ShareState = {
      projectId: 'p',
      time: 10,
      loop: { start: 1, end: 5, enabled: false },
      masterVolume: 80,
      focusedCommentId: 'cmt1',
      mix: [
        { stemId: 'a', muted: true },
        { stemId: 'b', volume: 50 },
      ],
    };

    const result = applyShareState(state, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      player: player as any,
      viewport: makeViewport(),
      onFocusComment,
      onOpenDrawer,
    });

    expect(calls).toEqual([
      'loop(1,5)',
      'loopEnabled(false)',
      'mute(0)',
      'vol(1,50)',
      'master(80)',
      'seek(10)',
    ]);
    expect(onFocusComment).toHaveBeenCalledWith('cmt1');
    expect(onOpenDrawer).toHaveBeenCalledOnce();
    expect(result.appliedCategories).toEqual(['loop', 'mix', 'comment']);
    expect(result.time).toBe(10);
  });

  it('clamps time to duration', () => {
    const player = {
      state: makePlayer([], 30),
      setLoop: vi.fn(),
      setLoopEnabled: vi.fn(),
      setVolume: vi.fn(),
      toggleMute: vi.fn(),
      toggleSolo: vi.fn(),
      setMasterVolume: vi.fn(),
      seek: vi.fn(),
    };
    applyShareState(
      { projectId: 'p', time: 999 },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        player: player as any,
        viewport: makeViewport(),
        onFocusComment: vi.fn(),
        onOpenDrawer: vi.fn(),
      },
    );
    expect(player.seek).toHaveBeenCalledWith(30);
  });

  it('skips mix entries that reference unknown stems', () => {
    const stems = [makeStem({ serverId: 'a' })];
    const player = {
      state: makePlayer(stems),
      setLoop: vi.fn(),
      setLoopEnabled: vi.fn(),
      setVolume: vi.fn(),
      toggleMute: vi.fn(),
      toggleSolo: vi.fn(),
      setMasterVolume: vi.fn(),
      seek: vi.fn(),
    };
    applyShareState(
      { projectId: 'p', mix: [{ stemId: 'ghost', muted: true }] },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        player: player as any,
        viewport: makeViewport(),
        onFocusComment: vi.fn(),
        onOpenDrawer: vi.fn(),
      },
    );
    expect(player.toggleMute).not.toHaveBeenCalled();
  });

  it('does not open drawer when no focused comment', () => {
    const player = {
      state: makePlayer([]),
      setLoop: vi.fn(),
      setLoopEnabled: vi.fn(),
      setVolume: vi.fn(),
      toggleMute: vi.fn(),
      toggleSolo: vi.fn(),
      setMasterVolume: vi.fn(),
      seek: vi.fn(),
    };
    const onOpenDrawer = vi.fn();
    applyShareState(
      { projectId: 'p', time: 5 },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        player: player as any,
        viewport: makeViewport(),
        onFocusComment: vi.fn(),
        onOpenDrawer,
      },
    );
    expect(onOpenDrawer).not.toHaveBeenCalled();
  });

  it('applies view (hZoom + scrollLeft) from time window using recipient stage', () => {
    const stems = [makeStem({ serverId: 'a' })];
    const player = {
      state: makePlayer(stems, 60),
      setLoop: vi.fn(),
      setLoopEnabled: vi.fn(),
      setVolume: vi.fn(),
      toggleMute: vi.fn(),
      toggleSolo: vi.fn(),
      setMasterVolume: vi.fn(),
      seek: vi.fn(),
    };
    // Recipient stage: stageWidth=1000, rail=200, duration=60.
    // Requested window [12, 18] → span=6, waveVisible=800,
    // wave = 800*60/6 = 8000, innerWidth = 8200, hZoom = 8.2,
    // scrollLeft = 12/60 * 8000 = 1600.
    const viewport = makeViewport({ stageWidth: 1000, railWidth: 200 });
    const state: ShareState = {
      projectId: 'p',
      view: { timeLeft: 12, timeRight: 18 },
      trackHeight: 80,
    };

    const result = applyShareState(state, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      player: player as any,
      viewport,
      onFocusComment: vi.fn(),
      onOpenDrawer: vi.fn(),
    });

    expect(viewport.setView).toHaveBeenCalledOnce();
    const arg = (viewport.setView as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.hZoom).toBeCloseTo(8.2, 2);
    expect(arg.scrollLeft).toBeCloseTo(1600, 0);
    expect(arg.trackHeight).toBe(80);
    expect(result.appliedCategories).toContain('view');
  });

  it('skips view when stageWidth is not yet measured', () => {
    const stems = [makeStem({ serverId: 'a' })];
    const player = {
      state: makePlayer(stems, 60),
      setLoop: vi.fn(),
      setLoopEnabled: vi.fn(),
      setVolume: vi.fn(),
      toggleMute: vi.fn(),
      toggleSolo: vi.fn(),
      setMasterVolume: vi.fn(),
      seek: vi.fn(),
    };
    const viewport = makeViewport({ stageWidth: 0, railWidth: 0 });
    const result = applyShareState(
      { projectId: 'p', view: { timeLeft: 1, timeRight: 2 } },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        player: player as any,
        viewport,
        onFocusComment: vi.fn(),
        onOpenDrawer: vi.fn(),
      },
    );
    expect(viewport.setView).not.toHaveBeenCalled();
    expect(result.appliedCategories).not.toContain('view');
  });
});
