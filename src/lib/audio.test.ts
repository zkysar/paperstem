import { describe, expect, test, beforeEach } from 'vitest';
import {
  stripCommonPrefix,
  AUDIO_EXT,
  loadVolume,
  saveVolume,
  shouldEndPlayback,
  shouldLoopWrap,
} from './audio';

describe('stripCommonPrefix', () => {
  test('removes shared prefix and extension', () => {
    expect(stripCommonPrefix(['sas7_Bass.wav', 'sas7_Drums.wav', 'sas7_Vox.wav']))
      .toEqual(['Bass', 'Drums', 'Vox']);
  });

  test('handles a single name', () => {
    expect(stripCommonPrefix(['only.wav'])).toEqual(['only']);
  });

  test('handles an empty list', () => {
    expect(stripCommonPrefix([])).toEqual([]);
  });

  test('keeps full names when there is no shared prefix', () => {
    expect(stripCommonPrefix(['alpha.wav', 'beta.wav'])).toEqual(['alpha', 'beta']);
  });
});

describe('AUDIO_EXT', () => {
  test.each(['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'webm', 'opus'])(
    'matches .%s',
    (ext) => {
      expect(AUDIO_EXT.test(`foo.${ext}`)).toBe(true);
    },
  );

  test('does not match non-audio extensions', () => {
    expect(AUDIO_EXT.test('foo.txt')).toBe(false);
    expect(AUDIO_EXT.test('foo.png')).toBe(false);
  });
});

describe('loadVolume / saveVolume', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('returns 80 by default', () => {
    expect(loadVolume('p1', 'stem.wav')).toBe(80);
  });

  test('returns 80 when no practiceId is set', () => {
    expect(loadVolume(null, 'stem.wav')).toBe(80);
  });

  test('round-trips a saved value', () => {
    saveVolume('p1', 'stem.wav', 42);
    expect(loadVolume('p1', 'stem.wav')).toBe(42);
  });

  test('clamps stored values to 0..100', () => {
    saveVolume('p1', 'stem.wav', 200);
    expect(loadVolume('p1', 'stem.wav')).toBe(100);
  });

  test('skips save when practiceId is null', () => {
    saveVolume(null, 'stem.wav', 50);
    expect(localStorage.length).toBe(0);
  });
});

describe('shouldLoopWrap', () => {
  const tail = 0.005;
  const loop = { start: 0, end: 1, enabled: true };

  test('wraps when playhead crosses loop.end during playback', () => {
    // prevT was just inside, t reaches the threshold.
    expect(shouldLoopWrap(0.996, 0.99, loop, tail)).toBe(true);
  });

  test('does not wrap when seek jumps past loop.end (prevT already past)', () => {
    // User seeked to 10; both prevT and t are past loop.end.
    expect(shouldLoopWrap(10, 10, loop, tail)).toBe(false);
  });

  test('does not wrap on the tick immediately after a wrap', () => {
    // After wrap: lastT was set to loop.start, t advances slightly.
    expect(shouldLoopWrap(0.01, 0, loop, tail)).toBe(false);
  });

  test('returns false when no loop is set', () => {
    expect(shouldLoopWrap(0.99, 0.98, null, tail)).toBe(false);
  });

  test('returns false when loop is disabled', () => {
    const disabled = { ...loop, enabled: false };
    expect(shouldLoopWrap(0.996, 0.99, disabled, tail)).toBe(false);
  });

  test('does not wrap while still playing inside the loop', () => {
    expect(shouldLoopWrap(0.5, 0.49, loop, tail)).toBe(false);
  });

  test('seek into the loop arms a future wrap, but the seek tick itself does not wrap', () => {
    // User seeks from t=10 (outside) to t=0.3 (inside). Next rAF reads t=0.3,
    // prevT=0.3 (set by seek). No wrap on this tick.
    expect(shouldLoopWrap(0.3, 0.3, loop, tail)).toBe(false);
    // After playing forward, eventually crosses end normally.
    expect(shouldLoopWrap(0.996, 0.99, loop, tail)).toBe(true);
  });
});

describe('shouldEndPlayback', () => {
  const tail = 0.02;

  test('true when playhead reaches end of song', () => {
    expect(shouldEndPlayback(59.99, 60, tail)).toBe(true);
  });

  test('false while still playing', () => {
    expect(shouldEndPlayback(30, 60, tail)).toBe(false);
  });

  test('false when duration is zero (nothing loaded)', () => {
    expect(shouldEndPlayback(0, 0, tail)).toBe(false);
  });
});
