import { describe, expect, test, beforeEach } from 'vitest';
import { stripCommonPrefix, AUDIO_EXT, loadVolume, saveVolume } from './audio';

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
