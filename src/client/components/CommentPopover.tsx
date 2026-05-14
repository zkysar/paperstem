import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { Link2, Pencil, Repeat, Star, Trash2, X } from 'lucide-react';
import type { Annotation } from '../../shared/types';
import type { CopyCommentLinkResult } from '../lib/share-url';
import { fmt } from '../lib/format';
import { isMac } from '../lib/platform';

type Props = {
  annotation: Annotation;
  color: string;
  anchorLeftPx: number;
  anchorTopPx: number;
  canEdit: boolean;
  isOwn: boolean;
  drawerOpen?: boolean;
  /** True when this popover came from a share link arrival; adds a pulse. */
  emphasize?: boolean;
  onLoopRegion(): void;
  onToggleStar(): void;
  onSaveEdit(body: string): void;
  onDelete(): void;
  /**
   * "Copy link to this comment" — writes a share URL to the clipboard and
   * returns `{ ok, categories }` so we can render a "Copied — includes X"
   * toast next to the button.
   */
  onCopyLink(): Promise<CopyCommentLinkResult>;
  onClose(): void;
};

function copyLabel(result: CopyCommentLinkResult): string {
  if (!result.ok) return 'Copy failed';
  if (result.categories.length === 0) return 'Link copied';
  return `Link copied — includes ${result.categories.join(', ')}`;
}

function isSubmitShortcut(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (e.key !== 'Enter') return false;
  return isMac() ? e.metaKey : e.ctrlKey;
}

export function CommentPopover({
  annotation,
  color,
  anchorLeftPx,
  anchorTopPx,
  canEdit,
  isOwn,
  drawerOpen = false,
  emphasize = false,
  onLoopRegion,
  onToggleStar,
  onSaveEdit,
  onDelete,
  onCopyLink,
  onClose,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<'above' | 'below'>('above');
  const [translateX, setTranslateX] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(annotation.body);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  async function handleCopyClick() {
    const result = await onCopyLink();
    setCopyToast(copyLabel(result));
    if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      setCopyToast(null);
      copyTimerRef.current = null;
    }, 2000);
  }

  const DRAWER_W = 320;

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 8) setPlacement('below');
    else setPlacement('above');
    const margin = 8;
    const rightLimit = window.innerWidth - margin - (drawerOpen ? DRAWER_W : 0);
    if (r.left < margin) setTranslateX(margin - r.left);
    else if (r.right > rightLimit)
      setTranslateX(rightLimit - r.right);
    else setTranslateX(0);
  }, [anchorLeftPx, anchorTopPx, drawerOpen, editing]);

  const author = annotation.user_display_name ?? annotation.user_email;
  const isRegion = annotation.end_ms !== null;
  const timeText = isRegion
    ? `${fmt(annotation.start_ms / 1000)} – ${fmt(annotation.end_ms! / 1000)}`
    : fmt(annotation.start_ms / 1000);

  const style: CSSProperties = {
    left: `${anchorLeftPx}px`,
    top: `${anchorTopPx}px`,
    transform: `translateX(calc(-50% + ${translateX}px))${
      placement === 'below'
        ? ' translateY(8px)'
        : ' translateY(-100%) translateY(-8px)'
    }`,
  };

  function startEdit() {
    setDraft(annotation.body);
    setEditing(true);
  }
  function cancelEdit() {
    setDraft(annotation.body);
    setEditing(false);
  }
  function commitEdit() {
    const text = draft.trim();
    if (!text) return;
    onSaveEdit(text);
    setEditing(false);
  }
  function handleDelete() {
    if (!window.confirm('Delete this comment?')) return;
    onDelete();
  }

  return (
    <div
      ref={cardRef}
      className={
        'comment-popover placement-' +
        placement +
        (emphasize ? ' share-arrival-emphasis' : '')
      }
      style={style}
      role="dialog"
      aria-label="Comment"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="cp-meta">
        <span className="cp-avatar" style={{ background: color }}>
          {author.slice(0, 2).toUpperCase()}
        </span>
        <span className="cp-author" style={{ color }}>{author}</span>
        <span className="cp-time">{timeText}</span>
        {isRegion && (
          <button
            type="button"
            className="cp-iconbtn"
            aria-label="Loop region"
            title="Loop region"
            onClick={(e) => {
              e.stopPropagation();
              onLoopRegion();
            }}
          >
            <Repeat size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            className={'cp-iconbtn cp-star' + (annotation.starred ? ' on' : '')}
            aria-label={annotation.starred ? 'Unstar' : 'Star'}
            onClick={(e) => { e.stopPropagation(); onToggleStar(); }}
          >
            <Star size={14} strokeWidth={2} fill={annotation.starred ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
        )}
        <span className="cp-copy-wrap">
          <button
            type="button"
            className="cp-iconbtn"
            aria-label="Copy link to this comment"
            title="Copy link — includes time, plus loop / mix / view if set"
            onClick={(e) => { e.stopPropagation(); void handleCopyClick(); }}
          >
            <Link2 size={14} strokeWidth={2} aria-hidden="true" />
          </button>
          {copyToast && (
            <span className="cp-copy-toast" role="status" aria-live="polite">
              {copyToast}
            </span>
          )}
        </span>
        <button
          type="button"
          className="cp-iconbtn cp-close"
          aria-label="Close"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        >
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      {editing ? (
        <div className="cp-edit">
          <textarea
            autoFocus
            value={draft}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (isSubmitShortcut(e) && draft.trim().length > 0) {
                e.preventDefault();
                commitEdit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
              }
            }}
          />
          <div className="cp-edit-actions">
            <button type="button" onClick={cancelEdit}>Cancel</button>
            <button
              type="button"
              className="cp-save"
              disabled={draft.trim().length === 0}
              onClick={commitEdit}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="cp-body">{annotation.body}</div>
          {isOwn && canEdit && (
            <div className="cp-actions">
              <button
                type="button"
                className="cp-iconbtn"
                aria-label="Edit"
                onClick={(e) => { e.stopPropagation(); startEdit(); }}
              >
                <Pencil size={14} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="cp-iconbtn"
                aria-label="Delete"
                onClick={(e) => { e.stopPropagation(); handleDelete(); }}
              >
                <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
