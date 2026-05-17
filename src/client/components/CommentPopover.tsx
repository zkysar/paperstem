import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { Link2, MoreHorizontal, Pencil, Repeat, Star, Trash2, X } from 'lucide-react';
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
  anchorLeftPx: number;
  anchorTopPx: number;
  canEdit: boolean;
  canReact?: boolean;
  isOwn: boolean;
  drawerOpen?: boolean;
  /** True when this popover came from a share link arrival; adds a pulse. */
  emphasize?: boolean;
  onLoopRegion(): void;
  onToggleStar(): void;
  onSaveEdit(body: string): void;
  onDelete(): void;
  /**
   * "Copy link to this comment" — opens the share dialog pre-populated
   * with this comment as the link target.
   */
  onCopyLink(): void;
  onClose(): void;
  selfUserId: string;
  isNarrow: boolean;
  replies: AnnotationReply[] | undefined;
  replyCount: number;
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

export function CommentPopover({
  annotation,
  color,
  anchorLeftPx,
  anchorTopPx,
  canEdit,
  canReact = true,
  isOwn,
  drawerOpen = false,
  emphasize = false,
  onLoopRegion,
  onToggleStar,
  onSaveEdit,
  onDelete,
  onCopyLink,
  onClose,
  selfUserId,
  isNarrow,
  replies,
  replyCount,
  onLoadReplies,
  onCreateReply,
  onEditReply,
  onDeleteReply,
  onToggleReaction,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<'above' | 'below'>('above');
  const [translateX, setTranslateX] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(annotation.body);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const DRAWER_W = 320;

  // Escape closes the popover. The global keyboard hook handles this when
  // focus is on body, but bails when focus is inside any input/textarea
  // (e.g. the drawer's draft composer). A popover-scoped listener catches
  // those cases too. Inner Esc handlers (edit, reply compose, overflow
  // menu) all call preventDefault, so the defaultPrevented guard lets them
  // cancel their own state without also dismissing the popover.
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
    if (!menuOpen) return;
    function handleDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Capture phase + preventDefault — must run before the popover-close
      // listener so pressing Esc while the menu is open closes only the menu.
      e.preventDefault();
      e.stopPropagation();
      setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleDocClick);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [menuOpen]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const reflow = () => {
      const node = cardRef.current;
      if (!node) return;
      const r = node.getBoundingClientRect();
      const margin = 8;
      const rightLimit = window.innerWidth - margin - (drawerOpen ? DRAWER_W : 0);

      // Recover the anchor's viewport y from the popover's current position so
      // we can re-decide placement after the popover grows (reply composer
      // opens, replies expand, body edit, etc.).
      const anchorY = placement === 'above' ? r.bottom + margin : r.top - margin;
      const aboveSpace = anchorY - margin;
      const belowSpace = window.innerHeight - anchorY - margin;
      const fitsAbove = r.height <= aboveSpace;
      const fitsBelow = r.height <= belowSpace;
      let next: 'above' | 'below';
      if (fitsAbove) next = 'above';
      else if (fitsBelow) next = 'below';
      else next = belowSpace > aboveSpace ? 'below' : 'above';
      setPlacement(next);

      setTranslateX((prev) => {
        const naturalLeft = r.left - prev;
        const naturalRight = r.right - prev;
        if (naturalLeft < margin) return margin - naturalLeft;
        if (naturalRight > rightLimit) return rightLimit - naturalRight;
        return 0;
      });
    };

    reflow();
    const ro = new ResizeObserver(reflow);
    ro.observe(el);
    window.addEventListener('resize', reflow);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', reflow);
    };
  }, [anchorLeftPx, anchorTopPx, drawerOpen, editing, placement]);

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
            title={annotation.starred ? 'Unstar this comment' : 'Star this comment to flag it for review'}
            onClick={(e) => { e.stopPropagation(); onToggleStar(); }}
          >
            <Star size={14} strokeWidth={2} fill={annotation.starred ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
        )}
        <div
          className={'cl-overflow' + (menuOpen ? ' open' : '')}
          ref={menuOpen ? menuRef : undefined}
        >
          <button
            type="button"
            className="cp-iconbtn cl-overflow-trigger"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="More actions"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((cur) => !cur);
            }}
          >
            <MoreHorizontal size={14} strokeWidth={2} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="cl-overflow-menu" role="menu" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                role="menuitem"
                className="cl-overflow-item"
                aria-label="Copy link to this comment"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onCopyLink();
                }}
              >
                <Link2 size={14} strokeWidth={2} aria-hidden="true" />
                <span>Copy link</span>
              </button>
              {isOwn && canEdit && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="cl-overflow-item"
                    aria-label="Edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      startEdit();
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
                      handleDelete();
                    }}
                  >
                    <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                    <span>Delete</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className="cp-iconbtn cp-close"
          aria-label="Close"
          title="Close this comment"
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
          <div className="cl-foot">
            <Reactions
              reactions={annotation.reactions}
              isNarrow={isNarrow}
              canReact={canReact}
              onToggle={(emoji) =>
                onToggleReaction({ kind: 'annotation', id: annotation.id }, emoji)
              }
            />
            <ReplyThread
              key={annotation.id}
              annotationId={annotation.id}
              replyCount={replyCount}
              replies={replies}
              selfUserId={selfUserId}
              canEdit={canEdit}
              canReact={canReact}
              isNarrow={isNarrow}
              onLoadReplies={onLoadReplies}
              onCreateReply={onCreateReply}
              onEditReply={onEditReply}
              onDeleteReply={onDeleteReply}
              onToggleReaction={(replyId, emoji) =>
                onToggleReaction({ kind: 'reply', id: replyId }, emoji)
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
