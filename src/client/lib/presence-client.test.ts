import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPresenceClient } from './presence-client';

describe('presenceClient — input state detector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts active when document is visible and an input fires', () => {
    const c = createPresenceClient({ now: () => Date.now() });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('mousemove'));
    expect(c.computeState()).toBe('active');
  });

  it('flips to idle after 60s of no input', () => {
    const c = createPresenceClient({ now: () => Date.now() });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('mousemove'));
    expect(c.computeState()).toBe('active');
    vi.advanceTimersByTime(60_001);
    expect(c.computeState()).toBe('idle');
  });

  it('flips to idle when tab is hidden', () => {
    const c = createPresenceClient({ now: () => Date.now() });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('mousemove'));
    expect(c.computeState()).toBe('active');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(c.computeState()).toBe('idle');
  });
});
