import { useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import { usePresence } from '../hooks/usePresence';
import { resolveDisplayName, presenceColorFor, presenceInitial } from '../lib/presence-format';
import { PresencePopover } from './PresencePopover';
import type { PresenceRowDto } from '../lib/presence-client';

type Props = {
  projectId: string;
  // When provided, rows belonging to this user are filtered out of the
  // visible list — the user's own profile avatar in the header already
  // represents "you", so the presence chip would otherwise just duplicate it.
  currentUserId?: string | null;
};

const MAX_AVATARS = 3;

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

type OpenState =
  | { kind: 'avatar'; userId: string }
  | { kind: 'overflow' }
  | null;

export function PresenceAvatars({ projectId, currentUserId }: Props) {
  const map = usePresence([projectId]);
  const snap = map[projectId] ?? { rows: [], anonymousCount: 0 };
  const [open, setOpen] = useState<OpenState>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());

  const filteredRows = currentUserId
    ? snap.rows.filter((r) => r.userId !== currentUserId)
    : snap.rows;
  if (filteredRows.length === 0 && snap.anonymousCount === 0) return null;

  const ordered = order(filteredRows);
  const visible = ordered.slice(0, MAX_AVATARS);
  const hidden = ordered.slice(MAX_AVATARS);
  const overflow = hidden.length;
  const totalPeople = ordered.length + snap.anonymousCount;

  function setRef(key: string) {
    return (el: HTMLButtonElement | null) => {
      if (el) triggerRefs.current.set(key, el);
      else triggerRefs.current.delete(key);
    };
  }

  function toggleAvatar(userId: string) {
    setOpen((prev) =>
      prev && prev.kind === 'avatar' && prev.userId === userId ? null : { kind: 'avatar', userId },
    );
  }

  function toggleOverflow() {
    setOpen((prev) => (prev && prev.kind === 'overflow' ? null : { kind: 'overflow' }));
  }

  let popoverElement: React.ReactNode = null;
  if (open?.kind === 'avatar') {
    const row = visible.find((r) => (r.userId ?? `anon:${r.lastBeatAt}`) === open.userId);
    const trigger = triggerRefs.current.get(`avatar:${open.userId}`);
    if (row && trigger) {
      popoverElement = (
        <PresencePopover
          mode="single"
          rows={[row]}
          triggerRect={trigger.getBoundingClientRect()}
          onClose={() => setOpen(null)}
        />
      );
    }
  } else if (open?.kind === 'overflow') {
    const trigger = triggerRefs.current.get('overflow');
    if (trigger) {
      popoverElement = (
        <PresencePopover
          mode="list"
          rows={hidden}
          triggerRect={trigger.getBoundingClientRect()}
          onClose={() => setOpen(null)}
        />
      );
    }
  }

  return (
    <>
      <div className="presence-avatars" role="group" aria-label={`${totalPeople} people viewing`}>
        {visible.map((row) => {
          const bg = presenceColorFor(row.userId);
          const idle = row.state === 'idle';
          const userId = row.userId ?? `anon:${row.lastBeatAt}`;
          const isOpen = open?.kind === 'avatar' && open.userId === userId;
          const name = resolveDisplayName(row);
          return (
            <button
              type="button"
              key={userId}
              ref={setRef(`avatar:${userId}`)}
              data-testid="presence-avatar"
              className={'presence-avatar' + (idle ? ' presence-avatar-idle' : '')}
              style={{ background: bg, boxShadow: idle ? 'none' : `0 0 0 2px ${bg}` }}
              aria-label={`${name}, ${idle ? 'idle' : 'active'}`}
              aria-haspopup="dialog"
              aria-expanded={isOpen}
              title={`${name} — ${idle ? 'idle' : 'active'}`}
              onClick={() => toggleAvatar(userId)}
            >
              {presenceInitial(name)}
            </button>
          );
        })}
        {overflow > 0 && (
          <button
            type="button"
            ref={setRef('overflow')}
            className="presence-overflow"
            data-testid="presence-overflow"
            aria-haspopup="dialog"
            aria-expanded={open?.kind === 'overflow'}
            aria-label={`${overflow} more viewers`}
            onClick={toggleOverflow}
          >
            +{overflow}
          </button>
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
      {popoverElement}
    </>
  );
}
