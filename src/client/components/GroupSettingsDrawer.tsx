import { useEffect, useState } from 'react';
import { LogOut, UserPlus, X } from 'lucide-react';
import type { BandMember, BandWithRole } from '../../shared/types';

type Props = {
  open: boolean;
  // The group whose settings we're viewing. Null while the parent is still
  // resolving the active group; we render a stub in that case so the drawer
  // can still be `open: true` without crashing.
  group: BandWithRole | null;
  onClose(): void;
  // Called after the user successfully leaves the group. The parent is
  // expected to drop the group from its local bands list so the active-
  // group fallback can pick a new one without flickering through the
  // just-left band.
  onLeft(leftGroupId: string): void;
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
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  // The most recently-invited member's email. Surfacing a one-line confirm
  // ("Invited foo@…") lets the owner verify the address before moving on.
  const [lastInvited, setLastInvited] = useState<{
    email: string;
    mailed: boolean;
  } | null>(null);

  // Reset transient state whenever the drawer closes or the group changes.
  useEffect(() => {
    if (!open) {
      setConfirmingLeave(false);
      setError(null);
      setLeaving(false);
    }
  }, [open]);

  // Escape closes the modal. Matches the keyboard pattern users expect for
  // dialogs; the scrim click already covers mouse users.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  useEffect(() => {
    setMembers(null);
    setConfirmingLeave(false);
    setError(null);
    setInviteEmail('');
    setInviteError(null);
    setLastInvited(null);
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

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!group) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    setInviting(true);
    setInviteError(null);
    setLastInvited(null);
    try {
      const res = await fetch(
        `/api/bands/${encodeURIComponent(group.id)}/members`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg =
          body.error === 'already_member'
            ? `${email} is already in this group.`
            : body.error === 'bad_email' || body.error === 'email_required'
              ? "That doesn't look like a valid email."
              : body.error === 'forbidden'
                ? 'Only the owner can invite new members.'
                : `HTTP ${res.status}`;
        setInviteError(msg);
        return;
      }
      const data = (await res.json()) as {
        member: BandMember;
        mailed: boolean;
      };
      setMembers((prev) => (prev ? [...prev, data.member] : [data.member]));
      setInviteEmail('');
      setLastInvited({ email: data.member.email, mailed: data.mailed });
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : String(e));
    } finally {
      setInviting(false);
    }
  }

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
        // Owners can't leave; the button is hidden for them, so this path
        // is only hit if the role changed server-side between page load
        // and click (rare). Don't promise a transfer-ownership flow that
        // doesn't exist yet.
        const msg =
          body.error === 'owner_cannot_leave'
            ? "You're the owner of this group and can't leave it."
            : `HTTP ${res.status}`;
        setError(msg);
        return;
      }
      onLeft(group.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLeaving(false);
    }
  }

  if (!open) return null;

  const canLeave = group !== null && group.role !== 'owner';
  const canInvite = group !== null && group.role === 'owner';

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
                Your role in <strong>{group.name}</strong>: {group.role}.
                {group.role === 'owner' && (
                  <>
                    {' '}
                    Owners can't leave their own group.
                  </>
                )}
              </p>

              {error && <div className="upload-error">{error}</div>}

              {canInvite && (
                <form
                  className="group-settings-invite"
                  onSubmit={(e) => void handleInvite(e)}
                >
                  <label className="upload-field">
                    <span>Invite a new member</span>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="email@example.com"
                      aria-label="Invite email"
                      autoComplete="off"
                    />
                  </label>
                  <button
                    type="submit"
                    className="group-settings-invite-btn"
                    disabled={inviting || !inviteEmail.trim()}
                  >
                    <UserPlus size={14} strokeWidth={2} aria-hidden="true" />
                    {inviting ? 'Inviting…' : 'Send invite'}
                  </button>
                  {inviteError && (
                    <div className="upload-error">{inviteError}</div>
                  )}
                  {lastInvited && (
                    <p className="group-settings-invite-success">
                      Added <strong>{lastInvited.email}</strong>.
                      {lastInvited.mailed
                        ? ' A magic-link email is on the way.'
                        : ' (No email was sent — share the sign-in link with them yourself.)'}
                    </p>
                  )}
                </form>
              )}

              <h3 className="group-settings-section">Members</h3>
              {members === null ? (
                <p>Loading…</p>
              ) : members.length === 0 ? (
                <p className="upload-hint">No members.</p>
              ) : (
                <ul className="group-member-list">
                  {members.map((m) => (
                    <li key={m.id} className="group-member-row">
                      <span
                        className="group-member-email"
                        title={m.email}
                      >
                        {m.email}
                      </span>
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
                        {leaving ? 'Leaving…' : `Leave ${group.name}`}
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
