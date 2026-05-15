import { useState, type KeyboardEvent } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { AnnotationReply } from '../../shared/types';
import { Reactions } from './Reactions';
import { isMac } from '../lib/platform';

type Props = {
  reply: AnnotationReply;
  selfUserId: string;
  canEdit: boolean;
  isNarrow: boolean;
  onEdit(replyId: string, body: string): Promise<void> | void;
  onDelete(replyId: string): Promise<void> | void;
  onToggleReaction(replyId: string, emoji: string): void;
};

function isSubmitShortcut(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (e.key !== 'Enter') return false;
  return isMac() ? e.metaKey : e.ctrlKey;
}

export function ReplyCard({
  reply,
  selfUserId,
  canEdit,
  isNarrow,
  onEdit,
  onDelete,
  onToggleReaction,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(reply.body);
  const [error, setError] = useState<string | null>(null);
  const author = reply.user_display_name ?? reply.user_email;
  const isOwn = reply.user_id === selfUserId;

  async function commit() {
    const text = draft.trim();
    if (!text) return;
    setError(null);
    try {
      await onEdit(reply.id, text);
      // Only exit edit mode on success so a failed save doesn't discard the draft.
      setEditing(false);
    } catch {
      setError("Couldn't save edit — try again.");
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this reply?')) return;
    setError(null);
    try {
      await onDelete(reply.id);
    } catch {
      setError("Couldn't delete — try again.");
    }
  }

  return (
    <div className="reply-card" data-testid={`reply-card-${reply.id}`}>
      <div className="reply-meta">
        <span className="reply-author">{author}</span>
      </div>
      {editing ? (
        <div className="reply-edit">
          <textarea
            autoFocus
            rows={2}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (isSubmitShortcut(e) && draft.trim().length > 0) {
                e.preventDefault();
                void commit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(reply.body);
                setEditing(false);
                setError(null);
              }
            }}
          />
          {error && <div className="reply-composer-error">{error}</div>}
          <div className="reply-edit-actions">
            <button
              type="button"
              onClick={() => {
                setDraft(reply.body);
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="reply-save"
              disabled={draft.trim().length === 0}
              onClick={() => void commit()}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="reply-body">{reply.body}</div>
          {error && <div className="reply-composer-error">{error}</div>}
        </>
      )}
      <Reactions
        reactions={reply.reactions}
        isNarrow={isNarrow}
        onToggle={(emoji) => onToggleReaction(reply.id, emoji)}
      />
      {isOwn && canEdit && !editing && (
        <div className="reply-actions">
          <button
            type="button"
            className="reply-iconbtn"
            aria-label="Edit"
            onClick={(e) => {
              e.stopPropagation();
              setDraft(reply.body);
              setEditing(true);
            }}
          >
            <Pencil size={12} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="reply-iconbtn"
            aria-label="Delete"
            onClick={(e) => {
              e.stopPropagation();
              void handleDelete();
            }}
          >
            <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
