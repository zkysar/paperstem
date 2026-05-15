import { useState, useEffect, useRef, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AnnotationReply } from '../../shared/types';
import { ReplyCard } from './ReplyCard';
import { isMac } from '../lib/platform';

type Props = {
  annotationId: string;
  replyCount: number;
  replies: AnnotationReply[] | undefined;
  selfUserId: string;
  canEdit: boolean;
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

export function ReplyThread({
  annotationId,
  replyCount,
  replies,
  selfUserId,
  canEdit,
  isNarrow,
  onLoadReplies,
  onCreateReply,
  onEditReply,
  onDeleteReply,
  onToggleReaction,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  // Track which annotationId we've already fetched for so a reused instance
  // (CommentPopover / CommentBottomSheet navigating between annotations) doesn't
  // skip the fetch when the prop changes.
  const fetchedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    if (replies !== undefined) return;
    if (fetchedForRef.current === annotationId) return;
    fetchedForRef.current = annotationId;
    void onLoadReplies(annotationId);
  }, [expanded, replies, annotationId, onLoadReplies]);

  async function submit() {
    const text = draft.trim();
    if (!text) return;
    await onCreateReply(annotationId, text);
    setDraft('');
    setComposing(false);
    setExpanded(true);
  }

  return (
    <div className="reply-thread">
      <div className="reply-thread-bar">
        {replyCount > 0 && (
          <button
            type="button"
            className="reply-expand"
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((x) => !x);
            }}
          >
            {expanded ? (
              <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
            ) : (
              <ChevronRight size={12} strokeWidth={2} aria-hidden="true" />
            )}
            {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            className="reply-cta"
            onClick={(e) => {
              e.stopPropagation();
              setComposing(true);
              setExpanded(true);
            }}
          >
            Reply
          </button>
        )}
      </div>
      {expanded && (
        <div className="reply-thread-list">
          {(replies ?? []).map((r) => (
            <ReplyCard
              key={r.id}
              reply={r}
              selfUserId={selfUserId}
              canEdit={canEdit}
              isNarrow={isNarrow}
              onEdit={onEditReply}
              onDelete={(id) => onDeleteReply(annotationId, id)}
              onToggleReaction={onToggleReaction}
            />
          ))}
          {composing && (
            <div className="reply-composer">
              <textarea
                autoFocus
                rows={2}
                aria-label="Reply"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (isSubmitShortcut(e) && draft.trim().length > 0) {
                    e.preventDefault();
                    void submit();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setDraft('');
                    setComposing(false);
                  }
                }}
              />
              <div className="reply-composer-actions">
                <button
                  type="button"
                  onClick={() => {
                    setDraft('');
                    setComposing(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="reply-save"
                  disabled={draft.trim().length === 0}
                  onClick={() => void submit()}
                >
                  Reply
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
