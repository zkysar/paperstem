import { Eye } from 'lucide-react';
import { usePresence } from '../hooks/usePresence';
import { paletteIndexForUserId, ANNOTATION_PALETTE } from '../lib/colors';
import type { PresenceRowDto } from '../lib/presence-client';

type Props = { projectId: string };

const MAX_AVATARS = 3;

function colorFor(userId: string | null): string {
  if (!userId) return '#6a6a6a';
  return ANNOTATION_PALETTE[paletteIndexForUserId(userId, ANNOTATION_PALETTE.length)];
}

function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : '?';
}

function dedupeByUserId(rows: PresenceRowDto[]): PresenceRowDto[] {
  const byUser = new Map<string, PresenceRowDto>();
  const anon: PresenceRowDto[] = [];
  for (const row of rows) {
    if (row.userId == null) { anon.push(row); continue; }
    const existing = byUser.get(row.userId);
    if (!existing) { byUser.set(row.userId, row); continue; }
    const existingActive = existing.state === 'active';
    const incomingActive = row.state === 'active';
    if (incomingActive && !existingActive) { byUser.set(row.userId, row); continue; }
    if (incomingActive === existingActive && row.lastBeatAt > existing.lastBeatAt) {
      byUser.set(row.userId, row);
    }
  }
  return [...byUser.values(), ...anon];
}

function order(rows: PresenceRowDto[]): PresenceRowDto[] {
  const deduped = dedupeByUserId(rows);
  const active = deduped.filter((r) => r.state === 'active').sort((a, b) => b.lastBeatAt - a.lastBeatAt);
  const idle = deduped.filter((r) => r.state === 'idle').sort((a, b) => b.lastBeatAt - a.lastBeatAt);
  return [...active, ...idle];
}

export function PresenceAvatars({ projectId }: Props) {
  const map = usePresence([projectId]);
  const snap = map[projectId] ?? { rows: [], anonymousCount: 0 };
  if (snap.rows.length === 0 && snap.anonymousCount === 0) return null;

  const ordered = order(snap.rows);
  const visible = ordered.slice(0, MAX_AVATARS);
  const overflow = Math.max(0, ordered.length - MAX_AVATARS);
  const totalPeople = ordered.length + snap.anonymousCount;

  return (
    <div
      className="presence-avatars"
      role="group"
      aria-label={`${totalPeople} people viewing`}
    >
      {visible.map((row) => {
        const bg = colorFor(row.userId);
        const idle = row.state === 'idle';
        return (
          <div
            key={row.userId ?? row.lastBeatAt}
            data-testid="presence-avatar"
            className={'presence-avatar' + (idle ? ' presence-avatar-idle' : '')}
            style={{ background: bg, boxShadow: idle ? 'none' : `0 0 0 2px ${bg}` }}
            aria-label={`${row.displayName}, ${idle ? 'idle' : 'active'}`}
            title={`${row.displayName} — ${idle ? 'idle' : 'active'}`}
          >
            {initial(row.displayName)}
          </div>
        );
      })}
      {overflow > 0 && (
        <div className="presence-overflow" data-testid="presence-overflow">+{overflow}</div>
      )}
      {snap.anonymousCount > 0 && (
        <div
          className="presence-anon"
          data-testid="presence-anon"
          aria-label={`${snap.anonymousCount} anonymous viewers`}
          title={`${snap.anonymousCount} anonymous viewers`}
        >
          <Eye size={12} strokeWidth={2} aria-hidden="true" />
          <span>{snap.anonymousCount}</span>
        </div>
      )}
    </div>
  );
}
