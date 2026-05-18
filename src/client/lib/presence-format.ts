import type { PresenceRowDto } from './presence-client';

export function resolveDisplayName(row: PresenceRowDto): string {
  if (row.displayName.trim()) return row.displayName.trim();
  if (row.emailLocal && row.emailLocal.trim()) return row.emailLocal.trim();
  return 'Unknown';
}

export function formatPresenceState(row: PresenceRowDto, now: number): string {
  if (row.state === 'active') return 'Active now';
  const deltaMs = Math.max(0, now - row.lastBeatAt);
  const deltaMin = Math.floor(deltaMs / 60_000);
  if (deltaMin < 1) return 'Idle just now';
  if (deltaMin < 60) {
    return `Idle ${deltaMin} ${deltaMin === 1 ? 'minute' : 'minutes'} ago`;
  }
  const deltaHr = Math.floor(deltaMin / 60);
  return `Idle ${deltaHr} ${deltaHr === 1 ? 'hour' : 'hours'} ago`;
}
