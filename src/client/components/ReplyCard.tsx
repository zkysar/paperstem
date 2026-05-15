import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const author = reply.user_display_name ?? reply.user_email;
  const isOwn = reply.user_id === selfUserId;

  useEffect(() => {
    if (!menuOpen) return;
    function handleDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleDocClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

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
        {isOwn && canEdit && !editing && (
          <div
            className={'cl-overflow' + (menuOpen ? ' open' : '')}
            ref={menuOpen ? menuRef : undefined}
          >
            <button
              type="button"
              className="cl-iconbtn cl-overflow-trigger"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="More actions"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((cur) => !cur);
              }}
            ><MoreHorizontal size={14} strokeWidth={2} aria-hidden="true" /></button>
            {menuOpen && (
              <div className="cl-overflow-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  role="menuitem"
                  className="cl-overflow-item"
                  aria-label="Edit"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    setDraft(reply.body);
                    setEditing(true);
                  }}
                >
                  <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="cl-overflow-item cl-overflow-item-danger"
                  aria-label="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    void handleDelete();
                  }}
                >
                  <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                  <span>Delete</span>
                </button>
              </div>
            )}
          </div>
        )}
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
              className="reply-cancel"
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
    </div>
  );
}
