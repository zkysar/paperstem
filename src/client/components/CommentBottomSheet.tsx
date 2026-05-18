import { useEffect, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Repeat, Star, Trash2, X } from 'lucide-react';
import type {
  Annotation,
  AnnotationReply,
  ReactionTarget,
} from '../../shared/types';
import { fmt } from '../lib/format';
import { isMac } from '../lib/platform';
import { Reactions } from './Reactions';
import { ReplyThread } from './ReplyThread';

type Props = {
  annotation: Annotation;
  color: string;
  canEdit: boolean;
  canReact?: boolean;
  isOwn: boolean;
  index: number;
  total: number;
  onPrev(): void;
  onNext(): void;
  onLoopRegion(): void;
  onToggleStar(): void;
  onSaveEdit(body: string): void;
  onDelete(): void;
  onClose(): void;
  selfUserId: string;
  selfDisplayName: string;
  selfColor: string;
  userColorMap: Map<string, string>;
  replies: AnnotationReply[] | undefined;
  onLoadReplies(annotationId: string): Promise<void> | void;
  onCreateReply(annotationId: string, body: string): Promise<void> | void;
  onEditReply(replyId: string, body: string): Promise<void> | void;
  onDeleteReply(annotationId: string, replyId: string): Promise<void> | void;
  onToggleReaction(target: ReactionTarget, emoji: string): void;
};

function isSubmitShortcut(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (e.key !== 'Enter') return false;
  return isMac() ? e.metaKey : e.ctrlKey;
}

export function CommentBottomSheet({
  annotation, color, canEdit, canReact = true, isOwn, index, total,
  onPrev, onNext, onLoopRegion, onToggleStar, onSaveEdit, onDelete, onClose,
  selfUserId, selfDisplayName, selfColor, userColorMap, replies,
  onLoadReplies, onCreateReply, onEditReply, onDeleteReply, onToggleReaction,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(annotation.body);
  const [kbInset, setKbInset] = useState(0);

  // Escape closes the sheet. Mirrors CommentPopover — inner Esc handlers
  // (edit, reply compose) preventDefault, so the defaultPrevented guard
  // lets them cancel their own state without also dismissing the sheet.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKbInset(inset);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  const author = annotation.user_display_name ?? annotation.user_email;
  const isRegion = annotation.end_ms !== null;
  const timeText = isRegion
    ? `${fmt(annotation.start_ms / 1000)} – ${fmt(annotation.end_ms! / 1000)}`
    : fmt(annotation.start_ms / 1000);

  function commitEdit() {
    const text = draft.trim();
    if (!text) return;
    onSaveEdit(text);
    setEditing(false);
  }

  return (
    <div
      className="comment-sheet"
      role="dialog"
      aria-label="Comment"
      onPointerDown={(e) => e.stopPropagation()}
      style={{ paddingBottom: `calc(env(safe-area-inset-bottom) + ${kbInset}px)` }}
    >
      <div className="cs-handle" aria-hidden="true" />
      <div className="cs-meta">
        <span className="cs-avatar" style={{ background: color }}>
          {author.slice(0, 2).toUpperCase()}
        </span>
        <span className="cs-author" style={{ color }}>{author}</span>
        <span className="cs-time">{timeText}</span>
        {isRegion && (
          <button
            type="button"
            className="cs-iconbtn"
            aria-label="Loop region"
            onClick={onLoopRegion}
          ><Repeat size={16} strokeWidth={2} aria-hidden="true" /></button>
        )}
        {canEdit && (
          <button
            type="button"
            className={'cs-iconbtn cs-star' + (annotation.starred ? ' on' : '')}
            aria-label={annotation.starred ? 'Unstar' : 'Star'}
            onClick={onToggleStar}
          ><Star size={16} strokeWidth={2} fill={annotation.starred ? 'currentColor' : 'none'} aria-hidden="true" /></button>
        )}
        <button
          type="button"
          className="cs-iconbtn cs-close"
          aria-label="Close"
          onClick={onClose}
        ><X size={16} strokeWidth={2} aria-hidden="true" /></button>
      </div>
      {editing ? (
        <div className="cs-edit">
          <textarea
            autoFocus
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (isSubmitShortcut(e) && draft.trim().length > 0) {
                e.preventDefault();
                commitEdit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(annotation.body);
                setEditing(false);
              }
            }}
          />
          <div className="cs-edit-actions">
            <button
              type="button"
              onClick={() => { setDraft(annotation.body); setEditing(false); }}
            >Cancel</button>
            <button
              type="button"
              className="cs-save"
              disabled={draft.trim().length === 0}
              onClick={commitEdit}
            >Save</button>
          </div>
        </div>
      ) : (
        <>
          <div className="cs-body">{annotation.body}</div>
          {isOwn && canEdit && (
            <div className="cs-actions">
              <button
                type="button"
                className="cs-iconbtn"
                aria-label="Edit"
                onClick={() => { setDraft(annotation.body); setEditing(true); }}
              ><Pencil size={16} strokeWidth={2} aria-hidden="true" /></button>
              <button
                type="button"
                className="cs-iconbtn"
                aria-label="Delete"
                onClick={() => {
                  if (window.confirm('Delete this comment?')) onDelete();
                }}
              ><Trash2 size={16} strokeWidth={2} aria-hidden="true" /></button>
            </div>
          )}
        </>
      )}
      <Reactions
        reactions={annotation.reactions}
        isNarrow={true}
        canReact={canReact}
        onToggle={(emoji) =>
          onToggleReaction({ kind: 'annotation', id: annotation.id }, emoji)
        }
      />
      <ReplyThread
        key={annotation.id}
        annotationId={annotation.id}
        replies={replies}
        selfUserId={selfUserId}
        selfDisplayName={selfDisplayName}
        selfColor={selfColor}
        userColorMap={userColorMap}
        canEdit={canEdit}
        canReact={canReact}
        isNarrow={true}
        onLoadReplies={onLoadReplies}
        onCreateReply={onCreateReply}
        onEditReply={onEditReply}
        onDeleteReply={onDeleteReply}
        onToggleReaction={(replyId, emoji) =>
          onToggleReaction({ kind: 'reply', id: replyId }, emoji)
        }
      />
      <div className="cs-nav">
        <button
          type="button"
          aria-label="Previous comment"
          disabled={index === 0}
          onClick={onPrev}
        ><ChevronLeft size={14} strokeWidth={2} aria-hidden="true" /> prev</button>
        <span>{index + 1} / {total}</span>
        <button
          type="button"
          aria-label="Next comment"
          disabled={index >= total - 1}
          onClick={onNext}
        >next <ChevronRight size={14} strokeWidth={2} aria-hidden="true" /></button>
      </div>
    </div>
  );
}
