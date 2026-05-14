import { describe, expect, it, vi } from 'vitest';
import { applyShareState } from './apply-share-state';
import type { ShareState } from './share-url';
import type { LoadedStem, PlayerState } from '../data/types';

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
    driveFolderId: null,
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
        onFocusComment: vi.fn(),
        onOpenDrawer,
      },
    );
    expect(onOpenDrawer).not.toHaveBeenCalled();
  });
});
