import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, LogOut, Pencil, Plus, Trash2, UserPlus, X } from 'lucide-react';
import type { BandMember, BandWithRole } from '../../shared/types';

type Props = {
  open: boolean;
  // Every group the signed-in user belongs to. The drawer is the single
  // home for cross-group management, so it always renders the full list,
  // not just the active group.
  groups: BandWithRole[];
  // The currently-active group (the one whose projects are visible in the
  // rest of the app). The row for this group is marked and auto-expanded
  // on first open so the common case ("manage the group I'm working in")
  // is one click in instead of two.
  currentGroupId: string | null;
  onClose(): void;
  // Bubbled up from a row: the user just left a group.
  onLeft(leftGroupId: string): void;
  // Bubbled up from a row: an owner just deleted their group.
  onDeleted(deletedGroupId: string): void;
  // Bubbled up from a row: an owner just renamed their group.
  onRenamed?(groupId: string, newName: string): void;
  // Opens the parent's create-group dialog. Lives at the parent so the
  // dialog can survive the drawer closing if we ever want it to.
  onCreateGroup(): void;
};

export function GroupsDrawer({
  open,
  groups,
  currentGroupId,
  onClose,
  onLeft,
  onDeleted,
  onRenamed,
  onCreateGroup,
}: Props) {
  // Auto-expand the active group on first open. Stored as a Set so future
  // rows the user clicks toggle independently — accordion-style behavior
  // (only one open at a time) would force users to recollapse before
  // comparing rosters, which is the main reason to open this drawer at all.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Ref so the re-seed effect can read the latest currentGroupId without
  // listing it in deps. Listing it would re-seed (and collapse other rows)
  // any time the active group changed while the drawer was open — e.g. the
  // user leaves the active group from inside the drawer.
  const currentGroupIdRef = useRef(currentGroupId);
  useEffect(() => {
    currentGroupIdRef.current = currentGroupId;
  }, [currentGroupId]);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Re-seed expanded set every time the drawer transitions to open so
    // closing + reopening returns to "active group expanded, others
    // collapsed" instead of remembering whatever state the user left it in.
    setExpanded(new Set(currentGroupIdRef.current ? [currentGroupIdRef.current] : []));
  }, [open]);

  // Focus management: move focus into the dialog on open, restore it on
  // close so keyboard users land back on whatever opened the drawer.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div
      className="upload-modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="groups-drawer-title"
      onClick={onClose}
    >
      <div className="upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="upload-modal-header">
          <h2 id="groups-drawer-title">Groups</h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="upload-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="upload-modal-body">
          <button
            type="button"
            className="groups-create-btn"
            onClick={onCreateGroup}
          >
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
            New group
          </button>

          {groups.length === 0 ? (
            <p className="upload-hint">
              You're not in any groups yet. Create one to share projects.
            </p>
          ) : (
            <ul className="groups-list">
              {groups.map((g) => (
                <GroupRow
                  key={g.id}
                  group={g}
                  isActive={g.id === currentGroupId}
                  isExpanded={expanded.has(g.id)}
                  onToggle={() => toggle(g.id)}
                  onLeft={onLeft}
                  onDeleted={onDeleted}
                  onRenamed={onRenamed}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

type GroupRowProps = {
  group: BandWithRole;
  isActive: boolean;
  isExpanded: boolean;
  onToggle(): void;
  onLeft(groupId: string): void;
  onDeleted(groupId: string): void;
  onRenamed?(groupId: string, newName: string): void;
};

type GetBandResponse = {
  band: { id: string; name: string };
  members: BandMember[];
};

function GroupRow({
  group,
  isActive,
  isExpanded,
  onToggle,
  onLeft,
  onDeleted,
  onRenamed,
}: GroupRowProps) {
  const [members, setMembers] = useState<BandMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [transferTo, setTransferTo] = useState<string>('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [lastInvited, setLastInvited] = useState<{
    email: string;
    mailed: boolean;
  } | null>(null);
  const [renameMode, setRenameMode] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  // Lazy-load members the first time the row is expanded. Re-fetches if
  // the row is collapsed and re-expanded so role changes (someone promoted
  // / demoted in another tab) show up without a full drawer reopen.
  useEffect(() => {
    if (!isExpanded) return;
    let cancelled = false;
    setMembers(null);
    setError(null);
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
  }, [isExpanded, group.id]);

  // Reset transient form state when the row collapses so a half-typed
  // invite doesn't reappear next time.
  useEffect(() => {
    if (!isExpanded) {
      setConfirmingLeave(false);
      setTransferTo('');
      setConfirmingDelete(false);
      setInviteEmail('');
      setInviteError(null);
      setLastInvited(null);
      setRenameMode(false);
      setRenameDraft('');
      setRenameError(null);
      setRemoveConfirmId(null);
      setError(null);
    }
  }, [isExpanded]);

  async function handleRename() {
    const next = renameDraft.trim();
    if (!next || next === group.name) {
      setRenameMode(false);
      return;
    }
    setRenaming(true);
    setRenameError(null);
    try {
      const res = await fetch(`/api/bands/${encodeURIComponent(group.id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg =
          body.error === 'duplicate_name'
            ? `You already own a group called "${next}".`
            : body.error === 'duplicate_name_pending_purge'
              ? `You recently deleted a group called "${next}". The name will free up after the 30-day purge.`
            : body.error === 'name_too_long'
              ? 'Group names are limited to 80 characters.'
              : body.error === 'name_required'
                ? 'A name is required.'
                : `HTTP ${res.status}`;
        setRenameError(msg);
        return;
      }
      onRenamed?.(group.id, next);
      setRenameMode(false);
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : String(e));
    } finally {
      setRenaming(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/bands/${encodeURIComponent(group.id)}/members/${encodeURIComponent(memberId)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg =
          body.error === 'owner_cannot_be_removed'
            ? "You can't remove the owner of a group."
            : `HTTP ${res.status}`;
        setError(msg);
        return;
      }
      setMembers((prev) =>
        prev ? prev.filter((m) => m.id !== memberId) : prev,
      );
      setRemoveConfirmId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
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
    setLeaving(true);
    setError(null);
    // Owners must pick a member to transfer ownership to before leaving.
    // The picker is required when the role is 'owner'; the server enforces
    // the same rule, so a stale picker state can only ever produce a 409.
    const isOwner = group.role === 'owner';
    try {
      const init: RequestInit = {
        method: 'DELETE',
        credentials: 'include',
      };
      if (isOwner) {
        init.headers = { 'content-type': 'application/json' };
        init.body = JSON.stringify({ transferTo });
      }
      const res = await fetch(
        `/api/bands/${encodeURIComponent(group.id)}/members/me`,
        init,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg =
          body.error === 'owner_must_transfer'
            ? 'Pick a member to transfer ownership to before leaving.'
            : body.error === 'transfer_target_not_a_member'
              ? 'That person is no longer in this group — pick someone else.'
              : body.error === 'cannot_transfer_to_self'
                ? "You can't transfer ownership to yourself."
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

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/bands/${encodeURIComponent(group.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg =
          body.error === 'forbidden'
            ? 'Only the owner can delete a group.'
            : `HTTP ${res.status}`;
        setError(msg);
        return;
      }
      onDeleted(group.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  // Members can always leave. Owners can leave only after picking another
  // member to take the keys — so leave is available to an owner iff there's
  // at least one other member to receive ownership. The set of transfer
  // candidates is the loaded members list minus the owner themself.
  const transferCandidates =
    members?.filter((m) => m.role !== 'owner') ?? [];
  const isOwner = group.role === 'owner';
  const ownerHasTransferCandidates =
    members === null || transferCandidates.length > 0;
  const canLeave = !isOwner || ownerHasTransferCandidates;
  const canDelete = isOwner;
  const canInvite = isOwner;
  const canRename = isOwner;
  const canRemoveMembers = isOwner;

  return (
    <li className={'groups-row' + (isActive ? ' groups-row-active' : '')}>
      <button
        type="button"
        className="groups-row-header"
        aria-expanded={isExpanded}
        onClick={onToggle}
      >
        {isExpanded ? (
          <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
        )}
        <span className="groups-row-name">{group.name}</span>
        <span className={`group-member-role group-member-role-${group.role}`}>
          {group.role}
        </span>
        {isActive && (
          <span className="groups-row-active-pill">active</span>
        )}
      </button>

      {isExpanded && (
        <div className="groups-row-body">
          {renameMode && canRename ? (
            <div className="groups-row-rename">
              <input
                className="group-settings-rename-input"
                aria-label="Group name"
                value={renameDraft}
                autoFocus
                maxLength={80}
                disabled={renaming}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenameMode(false);
                    setRenameError(null);
                  }
                }}
                onBlur={() => {
                  // Don't exit rename mode while a PATCH is in flight. Setting
                  // `disabled` on a focused input fires onBlur before the
                  // request resolves, which would otherwise hide the input
                  // (and any server-side error) before the user could react.
                  if (renaming) return;
                  setRenameMode(false);
                  setRenameError(null);
                }}
              />
            </div>
          ) : (
            canRename && (
              <button
                type="button"
                className="groups-row-rename-trigger"
                aria-label={`Rename ${group.name}`}
                onClick={() => {
                  setRenameDraft(group.name);
                  setRenameError(null);
                  setRenameMode(true);
                }}
              >
                <Pencil size={12} strokeWidth={2} aria-hidden="true" />
                Rename group
              </button>
            )
          )}

          {error && <div className="upload-error" role="alert">{error}</div>}
          {renameError && <div className="upload-error" role="alert">{renameError}</div>}

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
                  aria-label={`Invite email for ${group.name}`}
                  autoComplete="off"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
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
                <div className="upload-error" role="alert">{inviteError}</div>
              )}
              {lastInvited && (
                <p className="group-settings-invite-success">
                  Added <strong>{lastInvited.email}</strong>.
                  {lastInvited.mailed
                    ? ' A magic-link email is on the way.'
                    : " (Email delivery didn't succeed — they can still sign in at the regular login page.)"}
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
              {members.map((m) => {
                const canRemoveThis = canRemoveMembers && m.role !== 'owner';
                const isConfirming = removeConfirmId === m.id;
                return (
                  <li key={m.id} className="group-member-row">
                    <span className="group-member-email" title={m.email}>
                      {m.email}
                    </span>
                    <span
                      className={`group-member-role group-member-role-${m.role}`}
                    >
                      {m.role}
                    </span>
                    {canRemoveThis && !isConfirming && (
                      <button
                        type="button"
                        className="group-member-remove-btn"
                        aria-label={`Remove ${m.email}`}
                        title={`Remove ${m.email}`}
                        onClick={() => setRemoveConfirmId(m.id)}
                      >
                        <X size={14} strokeWidth={2} aria-hidden="true" />
                      </button>
                    )}
                    {canRemoveThis && isConfirming && (
                      <span className="group-member-remove-confirm">
                        <button
                          type="button"
                          className="group-member-remove-confirm-yes"
                          disabled={removing}
                          onClick={() => void handleRemoveMember(m.id)}
                        >
                          {removing ? 'Removing…' : 'Remove'}
                        </button>
                        <button
                          type="button"
                          disabled={removing}
                          onClick={() => setRemoveConfirmId(null)}
                        >
                          Cancel
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {canLeave && (
            <div className="group-settings-leave">
              {!confirmingLeave ? (
                <button
                  type="button"
                  className="group-settings-leave-btn"
                  onClick={() => {
                    setConfirmingLeave(true);
                    // Pre-select the first candidate so the picker isn't
                    // empty by default for owners. Members ignore this.
                    if (isOwner && transferCandidates[0]) {
                      setTransferTo(transferCandidates[0].id);
                    }
                  }}
                >
                  <LogOut size={14} strokeWidth={2} aria-hidden="true" />
                  Leave group
                </button>
              ) : (
                <div className="group-settings-confirm">
                  {isOwner ? (
                    <>
                      <p>
                        Hand <strong>{group.name}</strong> to someone else and
                        leave. You'll lose access to the group's projects and
                        comments. The new owner gets full control, including
                        the ability to invite and remove members.
                      </p>
                      <label className="upload-field">
                        <span>Transfer ownership to</span>
                        <select
                          aria-label="Transfer ownership to"
                          value={transferTo}
                          disabled={leaving}
                          onChange={(e) => setTransferTo(e.target.value)}
                        >
                          {transferCandidates.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.email}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : (
                    <p>
                      Leave <strong>{group.name}</strong>? You'll lose access
                      to its projects and comments. The owner can re-add you
                      later.
                    </p>
                  )}
                  <button
                    type="button"
                    className="group-settings-leave-confirm"
                    disabled={leaving || (isOwner && !transferTo)}
                    onClick={() => void handleLeave()}
                  >
                    {leaving
                      ? 'Leaving…'
                      : isOwner
                        ? `Transfer & leave`
                        : `Leave ${group.name}`}
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

          {canDelete && (
            <div className="group-settings-delete">
              {!confirmingDelete ? (
                <>
                  <p className="upload-hint groups-row-owner-note">
                    {ownerHasTransferCandidates
                      ? "You're the owner. Deleting removes the group for everyone — to leave without taking the group down, transfer ownership above."
                      : "You're the only member. Invite someone above and transfer ownership to them, or delete the group."}
                  </p>
                  <button
                    type="button"
                    className="group-settings-delete-btn"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                    Delete group
                  </button>
                </>
              ) : (
                <div className="group-settings-confirm">
                  <p>
                    Delete <strong>{group.name}</strong>? The group will
                    disappear for every member, and its projects, stems, and
                    comments will go with it. Audio is purged after 30 days
                    and the group can't be restored from the app.
                  </p>
                  <button
                    type="button"
                    className="group-settings-delete-confirm"
                    disabled={deleting}
                    onClick={() => void handleDelete()}
                  >
                    {deleting ? 'Deleting…' : `Yes, delete ${group.name}`}
                  </button>
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
