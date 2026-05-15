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
  onEdit(replyId: string, body: string): void;
  onDelete(replyId: string): void;
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
  const author = reply.user_display_name ?? reply.user_email;
  const isOwn = reply.user_id === selfUserId;

  function commit() {
    const text = draft.trim();
    if (!text) return;
    onEdit(reply.id, text);
    setEditing(false);
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
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (isSubmitShortcut(e) && draft.trim().length > 0) {
                e.preventDefault();
                commit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(reply.body);
                setEditing(false);
              }
            }}
          />
          <div className="reply-edit-actions">
            <button
              type="button"
              onClick={() => {
                setDraft(reply.body);
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="reply-save"
              disabled={draft.trim().length === 0}
              onClick={commit}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="reply-body">{reply.body}</div>
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
              if (window.confirm('Delete this reply?')) onDelete(reply.id);
            }}
          >
            <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
