import { describe, it, expect } from 'vitest';
import { keyGlyph, isMac, isIOS, isAndroid } from './platform';

function setNav(props: Partial<{ platform: string; userAgent: string; maxTouchPoints: number }>) {
  for (const [k, v] of Object.entries(props)) {
    Object.defineProperty(navigator, k, { value: v, configurable: true });
  }
}

describe('keyGlyph', () => {
  it('renders Mac glyphs when forceMac=true', () => {
    expect(keyGlyph('mod', true)).toBe('⌘');
    expect(keyGlyph('alt', true)).toBe('⌥');
    expect(keyGlyph('ctrl', true)).toBe('⌃');
    expect(keyGlyph('shift', true)).toBe('⇧');
  });

  it('renders Windows/Linux words when forceMac=false', () => {
    expect(keyGlyph('mod', false)).toBe('Ctrl');
    expect(keyGlyph('alt', false)).toBe('Alt');
    expect(keyGlyph('ctrl', false)).toBe('Ctrl');
    expect(keyGlyph('shift', false)).toBe('Shift');
  });
});

describe('isMac', () => {
  it('returns true when navigator.platform contains Mac', () => {
    const orig = navigator.platform;
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
    expect(isMac()).toBe(true);
    Object.defineProperty(navigator, 'platform', {
      value: orig,
      configurable: true,
    });
  });

  it('returns false for non-Mac platforms', () => {
    const orig = navigator.platform;
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });
    expect(isMac()).toBe(false);
    Object.defineProperty(navigator, 'platform', {
      value: orig,
      configurable: true,
    });
  });
});

describe('isIOS', () => {
  const orig = {
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  };

  function restore() {
    setNav(orig);
  }

  it('returns true for iPhone userAgent', () => {
    setNav({
      platform: 'iPhone',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      maxTouchPoints: 5,
    });
    expect(isIOS()).toBe(true);
    restore();
  });

  it('returns true for iPadOS masquerading as Mac', () => {
    setNav({
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      maxTouchPoints: 5,
    });
    expect(isIOS()).toBe(true);
    restore();
  });

  it('returns false on macOS (no touch)', () => {
    setNav({
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      maxTouchPoints: 0,
    });
    expect(isIOS()).toBe(false);
    restore();
  });

  it('returns false on Windows', () => {
    setNav({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)', maxTouchPoints: 0 });
    expect(isIOS()).toBe(false);
    restore();
  });
});

describe('isAndroid', () => {
  const orig = {
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  };

  function restore() {
    setNav(orig);
  }

  it('returns true for an Android Chrome userAgent', () => {
    setNav({
      platform: 'Linux armv8l',
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      maxTouchPoints: 5,
    });
    expect(isAndroid()).toBe(true);
    restore();
  });

  it('returns false for iPhone', () => {
    setNav({
      platform: 'iPhone',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      maxTouchPoints: 5,
    });
    expect(isAndroid()).toBe(false);
    restore();
  });

  it('returns false on Windows', () => {
    setNav({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)', maxTouchPoints: 0 });
    expect(isAndroid()).toBe(false);
    restore();
  });
});
