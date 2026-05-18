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
