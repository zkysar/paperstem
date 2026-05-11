import { useState, type KeyboardEvent } from 'react';
import type { Annotation } from '../../shared/types';
import { fmt } from '../lib/format';

type Props = {
  annotation: Annotation;
  color: string;
  canEdit: boolean;
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
};

const IS_MAC =
  typeof navigator !== 'undefined' &&
  navigator.platform.toUpperCase().includes('MAC');

function isSubmitShortcut(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (e.key !== 'Enter') return false;
  return IS_MAC ? e.metaKey : e.ctrlKey;
}

export function CommentBottomSheet({
  annotation, color, canEdit, isOwn, index, total,
  onPrev, onNext, onLoopRegion, onToggleStar, onSaveEdit, onDelete, onClose,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(annotation.body);
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
          >⟲</button>
        )}
        {canEdit && (
          <button
            type="button"
            className={'cs-iconbtn cs-star' + (annotation.starred ? ' on' : '')}
            aria-label={annotation.starred ? 'Unstar' : 'Star'}
            onClick={onToggleStar}
          >{annotation.starred ? '★' : '☆'}</button>
        )}
        <button
          type="button"
          className="cs-iconbtn cs-close"
          aria-label="Close"
          onClick={onClose}
        >✕</button>
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
              >✎</button>
              <button
                type="button"
                className="cs-iconbtn"
                aria-label="Delete"
                onClick={() => {
                  if (window.confirm('Delete this comment?')) onDelete();
                }}
              >🗑</button>
            </div>
          )}
        </>
      )}
      <div className="cs-nav">
        <button
          type="button"
          aria-label="Previous comment"
          disabled={index === 0}
          onClick={onPrev}
        >‹ prev</button>
        <span>{index + 1} / {total}</span>
        <button
          type="button"
          aria-label="Next comment"
          disabled={index >= total - 1}
          onClick={onNext}
        >next ›</button>
      </div>
    </div>
  );
}
