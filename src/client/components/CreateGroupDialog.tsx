import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { BandWithRole } from '../../shared/types';

type Props = {
  open: boolean;
  onClose(): void;
  // Called with the newly-created group so the parent can set it as the
  // active group and refresh the bands list.
  onCreated(group: BandWithRole): void;
};

type CreateBandResponse = {
  band: BandWithRole;
};

const MAX_NAME_LEN = 80;

export function CreateGroupDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/bands', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg =
          body.error === 'duplicate_name'
            ? `You already own a group called "${trimmed}". Pick a different name.`
            : body.error === 'duplicate_name_pending_purge'
              ? `You recently deleted a group called "${trimmed}". The name will free up after the 30-day purge — for now, pick a different one.`
            : body.error === 'name_too_long'
              ? 'Group names are limited to 80 characters.'
              : body.error === 'name_required'
                ? 'A name is required.'
                : res.status === 401
                  ? "You're signed out — reload the page to sign in again."
                  : "Couldn't create the group. Try again.";
        setError(msg);
        return;
      }
      const data = (await res.json()) as CreateBandResponse;
      onCreated(data.band);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="upload-modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-group-title"
      onClick={onClose}
    >
      <div className="upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="upload-modal-header">
          <h2 id="create-group-title">New group</h2>
          <button
            type="button"
            className="upload-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <form
          className="upload-modal-body"
          onSubmit={(e) => void handleSubmit(e)}
        >
          <p className="upload-hint">
            A group holds the projects, audio, and comments that you share
            with a set of people. You'll be the owner.
          </p>

          {error && <div className="upload-error">{error}</div>}

          <label className="upload-field">
            <span>Group name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME_LEN}
              placeholder="e.g. Sun Toilet"
              autoFocus
              aria-label="Group name"
            />
          </label>

          <div className="create-group-actions">
            <button
              type="submit"
              className="create-group-submit"
              disabled={submitting || !name.trim()}
            >
              {submitting ? 'Creating…' : 'Create group'}
            </button>
            <button type="button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
