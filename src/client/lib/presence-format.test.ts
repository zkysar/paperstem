import { describe, expect, it } from 'vitest';
import { formatPresenceState, resolveDisplayName } from './presence-format';
import type { PresenceRowDto } from './presence-client';

function row(overrides: Partial<PresenceRowDto> = {}): PresenceRowDto {
  return {
    userId: 'u-1',
    displayName: 'Alice',
    emailLocal: 'alice',
    state: 'active',
    lastBeatAt: 0,
    ...overrides,
  };
}

describe('formatPresenceState', () => {
  it('returns "Active now" for an active row', () => {
    expect(formatPresenceState(row({ state: 'active' }), 10_000)).toBe('Active now');
  });

  it('returns "Idle just now" for an idle row within the last minute', () => {
    expect(formatPresenceState(row({ state: 'idle', lastBeatAt: 9_500 }), 10_000)).toBe('Idle just now');
  });

  it('returns "Idle X minutes ago" for an idle row 1-59 minutes old', () => {
    expect(formatPresenceState(row({ state: 'idle', lastBeatAt: 10_000 - 3 * 60_000 }), 10_000)).toBe('Idle 3 minutes ago');
    expect(formatPresenceState(row({ state: 'idle', lastBeatAt: 10_000 - 60_000 }), 10_000)).toBe('Idle 1 minute ago');
  });

  it('returns "Idle X hours ago" for an idle row >=60 minutes old', () => {
    expect(formatPresenceState(row({ state: 'idle', lastBeatAt: 10_000 - 2 * 60 * 60_000 }), 10_000)).toBe('Idle 2 hours ago');
    expect(formatPresenceState(row({ state: 'idle', lastBeatAt: 10_000 - 60 * 60_000 }), 10_000)).toBe('Idle 1 hour ago');
  });
});

describe('resolveDisplayName', () => {
  it('returns displayName when present and non-empty', () => {
    expect(resolveDisplayName(row({ displayName: 'Alice', emailLocal: 'a' }))).toBe('Alice');
  });

  it('falls back to emailLocal when displayName is empty', () => {
    expect(resolveDisplayName(row({ displayName: '', emailLocal: 'alice' }))).toBe('alice');
  });

  it('falls back to emailLocal when displayName is whitespace', () => {
    expect(resolveDisplayName(row({ displayName: '   ', emailLocal: 'alice' }))).toBe('alice');
  });

  it('returns "Unknown" when both displayName and emailLocal are missing', () => {
    expect(resolveDisplayName(row({ displayName: '', emailLocal: null }))).toBe('Unknown');
  });
});

import { positionPopover } from './presence-format';

const VIEWPORT = { width: 1000, height: 800 };

describe('positionPopover', () => {
  it('anchors below and left-aligned with the trigger by default', () => {
    const trigger = { left: 100, top: 50, right: 124, bottom: 74 } as DOMRect;
    const popover = { width: 200, height: 120 };
    const pos = positionPopover(trigger, popover, VIEWPORT);
    expect(pos).toEqual({ top: 74 + 8, left: 100 });
  });

  it('shifts left when the popover would clip the right edge', () => {
    const trigger = { left: 900, top: 50, right: 924, bottom: 74 } as DOMRect;
    const popover = { width: 200, height: 120 };
    const pos = positionPopover(trigger, popover, VIEWPORT);
    expect(pos.left).toBe(1000 - 200 - 8);
    expect(pos.top).toBe(74 + 8);
  });

  it('flips above when the popover would clip the bottom edge', () => {
    const trigger = { left: 100, top: 760, right: 124, bottom: 784 } as DOMRect;
    const popover = { width: 200, height: 120 };
    const pos = positionPopover(trigger, popover, VIEWPORT);
    expect(pos.top).toBe(632);
    expect(pos.left).toBe(100);
  });

  it('handles both right-clip and bottom-clip at once', () => {
    const trigger = { left: 900, top: 760, right: 924, bottom: 784 } as DOMRect;
    const popover = { width: 200, height: 120 };
    const pos = positionPopover(trigger, popover, VIEWPORT);
    expect(pos.left).toBe(1000 - 200 - 8);
    expect(pos.top).toBe(632);
  });

  it('clamps left to 8px if the trigger is near the left edge', () => {
    const trigger = { left: -50, top: 50, right: -26, bottom: 74 } as DOMRect;
    const popover = { width: 200, height: 120 };
    const pos = positionPopover(trigger, popover, VIEWPORT);
    expect(pos.left).toBe(8);
  });
});
