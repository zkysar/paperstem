import { describe, it, expect } from 'vitest';
import { keyGlyph, isMac } from './platform';

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
