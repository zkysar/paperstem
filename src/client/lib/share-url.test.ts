import { describe, expect, it } from 'vitest';
import {
  buildShareUrl,
  decodeShareUrl,
  describeShareCategories,
  encodeShareUrl,
  snapshotShareState,
  type ShareState,
} from './share-url';
import type { LoadedStem, PlayerState } from '../data/types';

describe('share-url', () => {
  it('round-trips a minimal state', () => {
    const state: ShareState = { projectId: 'abc123' };
    const fragment = encodeShareUrl(state);
    expect(fragment).toBe('p=abc123');
    expect(decodeShareUrl(fragment)).toEqual(state);
  });

  it('encodes time at 2 decimals and omits when zero', () => {
    expect(encodeShareUrl({ projectId: 'x', time: 0 })).toBe('p=x');
    expect(encodeShareUrl({ projectId: 'x', time: 42.5 })).toBe('p=x&t=42.50');
  });

  it('encodes a full state', () => {
    const f = encodeShareUrl({
      projectId: 'x',
      time: 10,
      loop: { start: 5, end: 8, enabled: false },
      masterVolume: 80,
      focusedCommentId: 'cmt_b',
      mix: [
        { stemId: 'stem_a', muted: true },
        { stemId: 'stem_b', soloed: true },
        { stemId: 'stem_c', volume: 50 },
      ],
    });
    expect(f).toBe(
      'p=x&t=10.00&l=5.00-8.00&le=0&mv=80&fc=cmt_b&mix=stem_a:m,stem_b:s,stem_c:v50',
    );
  });

  it('omits masterVolume at default', () => {
    expect(encodeShareUrl({ projectId: 'x', masterVolume: 100 })).toBe('p=x');
  });

  it('omits mix entries at default volume', () => {
    // A mix entry with all defaults still produces a header "a:" because the
    // encoder serializes the stemId prefix unconditionally. The plan accepts
    // this; consumers filter out empty-flag entries on decode (decoder skips
    // entries with no muted/soloed/volume).
    expect(
      encodeShareUrl({
        projectId: 'x',
        mix: [{ stemId: 'a', volume: 100 }],
      }),
    ).toBe('p=x&mix=a:');
  });

  it('returns null when p is missing', () => {
    expect(decodeShareUrl('t=10')).toBeNull();
    expect(decodeShareUrl('')).toBeNull();
    expect(decodeShareUrl('#')).toBeNull();
  });

  it('drops invalid loop entirely', () => {
    expect(decodeShareUrl('p=x&l=10-5')).toEqual({ projectId: 'x' });
    expect(decodeShareUrl('p=x&l=garbage')).toEqual({ projectId: 'x' });
  });

  it('ignores negative time', () => {
    expect(decodeShareUrl('p=x&t=-5')).toEqual({ projectId: 'x' });
  });

  it('parses mix with multiple flags', () => {
    expect(decodeShareUrl('p=x&mix=a:msv50')).toEqual({
      projectId: 'x',
      mix: [{ stemId: 'a', muted: true, soloed: true, volume: 50 }],
    });
  });

  it('handles leading # in fragment', () => {
    expect(decodeShareUrl('#p=abc&t=1.50')).toEqual({ projectId: 'abc', time: 1.5 });
  });

  it('ignores unknown keys (forward compat)', () => {
    expect(decodeShareUrl('p=x&future_key=hello')).toEqual({ projectId: 'x' });
  });

  it('round-trips a view (timeLeft/timeRight) and trackHeight', () => {
    const fragment = encodeShareUrl({
      projectId: 'x',
      view: { timeLeft: 12, timeRight: 18 },
      trackHeight: 80,
    });
    expect(fragment).toBe('p=x&tl=12.00&tr=18.00&tz=80');
    expect(decodeShareUrl(fragment)).toEqual({
      projectId: 'x',
      view: { timeLeft: 12, timeRight: 18 },
      trackHeight: 80,
    });
  });

  it('omits trackHeight at default', () => {
    expect(encodeShareUrl({ projectId: 'x', trackHeight: 44 })).toBe('p=x');
  });

  it('drops an inverted or negative view', () => {
    expect(decodeShareUrl('p=x&tl=10&tr=5')).toEqual({ projectId: 'x' });
    expect(decodeShareUrl('p=x&tl=-1&tr=5')).toEqual({ projectId: 'x' });
  });
});

function makeStem(over: Partial<LoadedStem>): LoadedStem {
  return {
    name: 'drums.mp3',
    displayName: 'drums',
    color: '#fff',
    audio: {} as HTMLAudioElement,
    userMuted: false,
    soloed: false,
    userVolume: 100,
    projectId: 'p',
    serverId: 'stem_default',
    gain: null,
    peaks: null,
    ...over,
  };
}
function makePlayer(over: Partial<PlayerState> = {}): PlayerState {
  return {
    projectId: 'p',
    title: 't',
    folderId: null,
    stems: [],
    duration: 60,
    referenceIdx: 0,
    isPlaying: false,
    loop: null,
    status: '',
    loading: null,
    waveformNormalization: 'per-track',
    masterVolume: 100,
    ...over,
  };
}

describe('snapshotShareState', () => {
  it('returns minimum state when nothing is non-default', () => {
    const s = snapshotShareState({
      projectId: 'p1',
      player: makePlayer(),
      currentTime: 0,
      activeCommentId: null,
    });
    expect(s).toEqual({ projectId: 'p1' });
  });

  it('captures time, loop, mix, comment', () => {
    const s = snapshotShareState({
      projectId: 'p1',
      player: makePlayer({
        stems: [
          makeStem({ serverId: 'a', userMuted: true }),
          makeStem({ serverId: 'b', userVolume: 50 }),
          makeStem({ serverId: 'c' }),
        ],
        loop: { start: 1, end: 2, enabled: true },
        masterVolume: 80,
      }),
      currentTime: 12.5,
      activeCommentId: 'cmt1',
    });
    expect(s.time).toBe(12.5);
    expect(s.loop).toEqual({ start: 1, end: 2, enabled: true });
    expect(s.masterVolume).toBe(80);
    expect(s.focusedCommentId).toBe('cmt1');
    expect(s.mix).toEqual([
      { stemId: 'a', muted: true },
      { stemId: 'b', volume: 50 },
    ]);
  });

  it('skips stems with null serverId (local-folder)', () => {
    const s = snapshotShareState({
      projectId: 'p1',
      player: makePlayer({ stems: [makeStem({ serverId: null, userMuted: true })] }),
      currentTime: 0,
      activeCommentId: null,
    });
    expect(s.mix).toBeUndefined();
  });

  it('overrides pin a specific time and comment', () => {
    const s = snapshotShareState(
      { projectId: 'p1', player: makePlayer(), currentTime: 5, activeCommentId: null },
      { time: 20, focusedCommentId: 'cmt2' },
    );
    expect(s.time).toBe(20);
    expect(s.focusedCommentId).toBe('cmt2');
  });

  it('captures the visible time window when zoomed in', () => {
    // duration=60, stageWidth=1000, rail=200, hZoom=4 → inner=4000, wave=3800,
    // visible wave = 800. scrollLeft=500 maps to tl = 500/3800*60 ≈ 7.894,
    // tr = (500+800)/3800*60 ≈ 20.526.
    const s = snapshotShareState({
      projectId: 'p1',
      player: makePlayer({ duration: 60 }),
      currentTime: 0,
      activeCommentId: null,
      viewport: {
        hZoom: 4,
        trackHeight: 44,
        scrollLeft: 500,
        stageWidth: 1000,
        railWidth: 200,
      },
    });
    expect(s.view).toBeDefined();
    expect(s.view!.timeLeft).toBeCloseTo(7.894, 2);
    expect(s.view!.timeRight).toBeCloseTo(20.526, 2);
    expect(s.trackHeight).toBeUndefined();
  });

  it('omits view at hZoom=1 (fit-to-window)', () => {
    const s = snapshotShareState({
      projectId: 'p1',
      player: makePlayer(),
      currentTime: 0,
      activeCommentId: null,
      viewport: {
        hZoom: 1,
        trackHeight: 44,
        scrollLeft: 0,
        stageWidth: 1000,
        railWidth: 200,
      },
    });
    expect(s.view).toBeUndefined();
    expect(s.trackHeight).toBeUndefined();
  });

  it('captures trackHeight when non-default even at hZoom=1', () => {
    const s = snapshotShareState({
      projectId: 'p1',
      player: makePlayer(),
      currentTime: 0,
      activeCommentId: null,
      viewport: {
        hZoom: 1,
        trackHeight: 80,
        scrollLeft: 0,
        stageWidth: 1000,
        railWidth: 200,
      },
    });
    expect(s.view).toBeUndefined();
    expect(s.trackHeight).toBe(80);
  });
});

describe('buildShareUrl', () => {
  it('builds a clean URL', () => {
    expect(buildShareUrl({ projectId: 'abc' }, 'https://x.app/')).toBe(
      'https://x.app/#p=abc',
    );
    expect(buildShareUrl({ projectId: 'abc', time: 10 }, 'https://x.app/somepath')).toBe(
      'https://x.app/somepath/#p=abc&t=10.00',
    );
  });
});

describe('describeShareCategories', () => {
  it('lists each non-default category', () => {
    expect(describeShareCategories({ projectId: 'x' })).toEqual([]);
    expect(
      describeShareCategories({
        projectId: 'x',
        loop: { start: 0, end: 1, enabled: true },
        mix: [{ stemId: 'a', muted: true }],
        focusedCommentId: 'c',
        view: { timeLeft: 1, timeRight: 2 },
      }),
    ).toEqual(['loop', 'mix', 'comment', 'view']);
  });

  it('lists view when only trackHeight is set', () => {
    expect(
      describeShareCategories({ projectId: 'x', trackHeight: 80 }),
    ).toEqual(['view']);
  });
});
