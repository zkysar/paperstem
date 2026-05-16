import { useEffect, useState } from 'react';
import { LogOut, X } from 'lucide-react';
import type { BandMember, BandWithRole } from '../../shared/types';

type Props = {
  open: boolean;
  // The group whose settings we're viewing. Null while the parent is still
  // resolving the active group; we render a stub in that case so the drawer
  // can still be `open: true` without crashing.
  group: BandWithRole | null;
  onClose(): void;
  // Called after the user successfully leaves the group. The parent is
  // expected to refresh its bands list so the active-group fallback can
  // pick a new one.
  onLeft(): void;
};

type GetBandResponse = {
  band: { id: string; name: string };
  members: BandMember[];
};

export function GroupSettingsDrawer({ open, group, onClose, onLeft }: Props) {
  const [members, setMembers] = useState<BandMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Reset transient state whenever the drawer closes or the group changes.
  useEffect(() => {
    if (!open) {
      setConfirmingLeave(false);
      setError(null);
      setLeaving(false);
    }
  }, [open]);
  useEffect(() => {
    setMembers(null);
    setConfirmingLeave(false);
    setError(null);
  }, [group?.id]);

  useEffect(() => {
    if (!open || !group) return;
    let cancelled = false;
    fetch(`/api/bands/${encodeURIComponent(group.id)}`, {
      credentials: 'include',
    }).then(
      async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const body = (await res.json()) as GetBandResponse;
        setMembers(body.members);
      },
      (err: Error) => {
        if (!cancelled) setError(err.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, group?.id]);

  async function handleLeave() {
    if (!group) return;
    setLeaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/bands/${encodeURIComponent(group.id)}/members/me`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg =
          body.error === 'owner_cannot_leave'
            ? "Owners can't leave their own group. Transfer ownership first."
            : `HTTP ${res.status}`;
        setError(msg);
        return;
      }
      onLeft();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLeaving(false);
    }
  }

  if (!open) return null;

  const canLeave = group !== null && group.role !== 'owner';

  return (
    <div
      className="upload-modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-settings-title"
      onClick={onClose}
    >
      <div className="upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="upload-modal-header">
          <h2 id="group-settings-title">
            {group ? group.name : 'Group settings'}
          </h2>
          <button
            type="button"
            className="upload-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="upload-modal-body">
          {!group && <p className="upload-hint">No group selected.</p>}

          {group && (
            <>
              <p className="upload-hint">
                You're a {group.role} of <strong>{group.name}</strong>.
              </p>

              {error && <div className="upload-error">{error}</div>}

              <h3 className="group-settings-section">Members</h3>
              {members === null ? (
                <p>Loading…</p>
              ) : members.length === 0 ? (
                <p className="upload-hint">No members.</p>
              ) : (
                <ul className="group-member-list">
                  {members.map((m) => (
                    <li key={m.id} className="group-member-row">
                      <span className="group-member-email">{m.email}</span>
                      <span
                        className={`group-member-role group-member-role-${m.role}`}
                      >
                        {m.role}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {canLeave && (
                <div className="group-settings-leave">
                  {!confirmingLeave ? (
                    <button
                      type="button"
                      className="group-settings-leave-btn"
                      onClick={() => setConfirmingLeave(true)}
                    >
                      <LogOut size={14} strokeWidth={2} aria-hidden="true" />
                      Leave group
                    </button>
                  ) : (
                    <div className="group-settings-confirm">
                      <p>
                        Leave <strong>{group.name}</strong>? You'll lose access
                        to its projects and comments. The owner can re-add you
                        later.
                      </p>
                      <button
                        type="button"
                        className="group-settings-leave-confirm"
                        disabled={leaving}
                        onClick={() => void handleLeave()}
                      >
                        {leaving ? 'Leaving…' : 'Yes, leave'}
                      </button>
                      <button
                        type="button"
                        disabled={leaving}
                        onClick={() => setConfirmingLeave(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
