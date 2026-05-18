import { useState, useEffect, useRef, type KeyboardEvent } from 'react';
import type { AnnotationReply } from '../../shared/types';
import { isMac } from '../lib/platform';
import { ReplyCard } from './ReplyCard';

type Props = {
  annotationId: string;
  replies: AnnotationReply[] | undefined;
  selfUserId: string;
  selfDisplayName: string;
  selfColor: string;
  userColorMap: Map<string, string>;
  canEdit: boolean;
  canReact?: boolean;
  isNarrow: boolean;
  onLoadReplies(annotationId: string): Promise<void> | void;
  onCreateReply(annotationId: string, body: string): Promise<void> | void;
  onEditReply(replyId: string, body: string): Promise<void> | void;
  onDeleteReply(annotationId: string, replyId: string): Promise<void> | void;
  onToggleReaction(replyId: string, emoji: string): void;
};

function isSubmitShortcut(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (e.key !== 'Enter') return false;
  return isMac() ? e.metaKey : e.ctrlKey;
}

function selfInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const source = trimmed.includes('@') ? (trimmed.split('@')[0] ?? trimmed) : trimmed;
  return source.slice(0, 2).toUpperCase();
}

export function ReplyThread({
  annotationId,
  replies,
  selfUserId,
  selfDisplayName,
  selfColor,
  userColorMap,
  canEdit,
  canReact = true,
  isNarrow,
  onLoadReplies,
  onCreateReply,
  onEditReply,
  onDeleteReply,
  onToggleReaction,
}: Props) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Track which annotationId we've already fetched for so a reused instance
  // (CommentPopover / CommentBottomSheet navigating between annotations)
  // doesn't skip the fetch when the prop changes.
  const fetchedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (replies !== undefined) {
      fetchedForRef.current = annotationId;
      return;
    }
    if (fetchedForRef.current === annotationId) return;
    fetchedForRef.current = annotationId;
    void Promise.resolve(onLoadReplies(annotationId)).catch(() => {
      // Clear the guard so a future remount / annotation switch can retry.
      fetchedForRef.current = null;
    });
  }, [annotationId, replies, onLoadReplies]);

  async function submit() {
    const text = draft.trim();
    if (!text) return;
    setError(null);
    try {
      await onCreateReply(annotationId, text);
      setDraft('');
      setComposerOpen(false);
    } catch {
      setError("Couldn't send reply — try again.");
    }
  }

  const list = replies ?? [];
  const hasReplies = list.length > 0;
  const initials = selfInitials(selfDisplayName);

  return (
    <div className={'cp-thread' + (hasReplies ? ' has-replies' : '')}>
      {list.map((r) => (
        <ReplyCard
          key={r.id}
          reply={r}
          selfUserId={selfUserId}
          userColorMap={userColorMap}
          canEdit={canEdit}
          canReact={canReact}
          isNarrow={isNarrow}
          onEdit={onEditReply}
          onDelete={(id) => onDeleteReply(annotationId, id)}
          onToggleReaction={onToggleReaction}
        />
      ))}
      {canEdit && (
        <div className="cp-composer">
          <span
            className="cp-composer-avatar"
            style={{ background: selfColor }}
            aria-hidden="true"
          >
            {initials}
          </span>
          {composerOpen ? (
            <div className="cp-composer-open">
              <textarea
                autoFocus
                rows={2}
                aria-label="Reply"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (isSubmitShortcut(e) && draft.trim().length > 0) {
                    e.preventDefault();
                    void submit();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setDraft('');
                    setComposerOpen(false);
                    setError(null);
                  }
                }}
              />
              {error && <div className="cp-composer-error">{error}</div>}
              <div className="cp-composer-actions">
                <button
                  type="button"
                  className="cp-reply-cancel"
                  onClick={() => {
                    setDraft('');
                    setComposerOpen(false);
                    setError(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="cp-reply-save"
                  disabled={draft.trim().length === 0}
                  onClick={() => void submit()}
                >
                  Reply
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="cp-composer-pill"
              onClick={() => setComposerOpen(true)}
            >
              Reply…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
