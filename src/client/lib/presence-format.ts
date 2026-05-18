import type { PresenceRowDto } from './presence-client';
import { paletteIndexForUserId, ANNOTATION_PALETTE } from './colors';

export function presenceColorFor(userId: string | null): string {
  if (!userId) return '#6a6a6a';
  return ANNOTATION_PALETTE[paletteIndexForUserId(userId, ANNOTATION_PALETTE.length)];
}

export function presenceInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : '?';
}

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

type Rect = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;

export function positionPopover(
  trigger: Rect,
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const MARGIN = 8;
  // Default: MARGIN below the trigger, left-aligned.
  let top = trigger.bottom + MARGIN;
  let left = trigger.left;

  // Right-edge clip: shift left so the right edge sits MARGIN inside the viewport.
  if (left + popover.width > viewport.width - MARGIN) {
    left = viewport.width - popover.width - MARGIN;
  }

  // Left clamp.
  if (left < MARGIN) left = MARGIN;

  // Bottom-edge clip: flip above the trigger.
  if (top + popover.height > viewport.height - MARGIN) {
    top = trigger.top - popover.height - MARGIN;
  }

  return { top, left };
}
