import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link2, MoreHorizontal, Pencil, Star, Trash2 } from 'lucide-react';
import type {
  Annotation,
  AnnotationReply,
  ReactionTarget,
} from '../../shared/types';
import { SELF_ANNOTATION_COLOR } from '../lib/colors';
import { fmt } from '../lib/format';
import { isMac } from '../lib/platform';
import { Reactions } from './Reactions';
import { ReplyThread } from './ReplyThread';

type Filter =
  | { kind: 'all' }
  | { kind: 'starred' }
  | { kind: 'mine' }
  | { kind: 'author'; userId: string };

type Props = {
  annotations: Annotation[];
  selfUserId: string;
  activeId: string | null;
  /**
   * Comment id that arrived via a share link's `fc=` param. The matching row
   * gets a sustained pulse to draw the recipient's eye beyond normal
   * selection emphasis.
   */
  emphasizedId?: string | null;
  userColorMap: Map<string, string>;
  canEdit: boolean;
  canReact?: boolean;
  isNarrow: boolean;
  onSelect(annotation: Annotation): void;
  onToggleStar(annotation: Annotation): void;
  onSaveEdit(annotation: Annotation, body: string): void;
  onDelete(annotation: Annotation): void;
  /**
   * "Copy link to this comment" — opens the share dialog pre-populated
   * with this comment as the link target. The user picks what state to
   * bundle and copies from there.
   */
  onCopyLink(annotation: Annotation): void;
  replies: Map<string, AnnotationReply[]>;
  onLoadReplies(annotationId: string): Promise<void> | void;
  onCreateReply(annotationId: string, body: string): Promise<void> | void;
  onEditReply(replyId: string, body: string): Promise<void> | void;
  onDeleteReply(annotationId: string, replyId: string): Promise<void> | void;
  onToggleReaction(target: ReactionTarget, emoji: string): void;
};

function authorLabel(a: Annotation): string {
  return a.user_display_name ?? a.user_email;
}

function timeText(a: Annotation): string {
  return a.end_ms === null
    ? fmt(a.start_ms / 1000)
    : `${fmt(a.start_ms / 1000)} – ${fmt(a.end_ms / 1000)}`;
}

function isSubmitShortcut(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (e.key !== 'Enter') return false;
  return isMac() ? e.metaKey : e.ctrlKey;
}

export function CommentList({
  annotations,
  selfUserId,
  activeId,
  emphasizedId,
  userColorMap,
  canEdit,
  canReact = true,
  isNarrow,
  onSelect,
  onToggleStar,
  onSaveEdit,
  onDelete,
  onCopyLink,
  replies,
  onLoadReplies,
  onCreateReply,
  onEditReply,
  onDeleteReply,
  onToggleReaction,
}: Props) {
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (menuOpenId === null) return;
    function handleDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpenId(null);
    }
    document.addEventListener('mousedown', handleDocClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpenId]);

  const authors = useMemo(() => {
    const seen = new Map<string, { userId: string; label: string }>();
    for (const a of annotations) {
      if (!seen.has(a.user_id)) {
        seen.set(a.user_id, { userId: a.user_id, label: authorLabel(a) });
      }
    }
    return Array.from(seen.values());
  }, [annotations]);

  const starredCount = annotations.filter((a) => a.starred).length;
  const mineCount = annotations.filter((a) => a.user_id === selfUserId).length;

  const filtered = useMemo(() => {
    switch (filter.kind) {
      case 'all': return annotations;
      case 'starred': return annotations.filter((a) => a.starred);
      case 'mine': return annotations.filter((a) => a.user_id === selfUserId);
      case 'author': return annotations.filter((a) => a.user_id === filter.userId);
    }
  }, [annotations, filter, selfUserId]);

  const showAuthorChips = authors.length >= 2;

  return (
    <div className="cl-wrap">
      <div className="cl-chips" role="tablist" aria-label="Filter comments">
        <button
          type="button"
          role="tab"
          className={'chip' + (filter.kind === 'all' ? ' active' : '')}
          aria-selected={filter.kind === 'all'}
          onClick={() => setFilter({ kind: 'all' })}
        >All {annotations.length}</button>
        <button
          type="button"
          role="tab"
          className={'chip' + (filter.kind === 'starred' ? ' active' : '')}
          aria-selected={filter.kind === 'starred'}
          onClick={() => setFilter({ kind: 'starred' })}
        ><><Star size={12} strokeWidth={2} fill="currentColor" aria-hidden="true" /> Starred {starredCount}</></button>
        <button
          type="button"
          role="tab"
          className={'chip' + (filter.kind === 'mine' ? ' active' : '')}
          aria-selected={filter.kind === 'mine'}
          onClick={() => setFilter({ kind: 'mine' })}
        >Mine {mineCount}</button>
        {showAuthorChips && authors
          .filter((a) => a.userId !== selfUserId)
          .map((a) => {
            const color = userColorMap.get(a.userId) ?? SELF_ANNOTATION_COLOR;
            const active = filter.kind === 'author' && filter.userId === a.userId;
            return (
              <button
                key={a.userId}
                type="button"
                role="tab"
                className={'chip' + (active ? ' active' : '')}
                aria-selected={active}
                style={active
                  ? { background: color, borderColor: color, color: 'var(--paper)' }
                  : { color }}
                onClick={() => setFilter({ kind: 'author', userId: a.userId })}
              >{a.label}</button>
            );
          })}
      </div>

      {filtered.length === 0 ? (
        <div className="cl-empty">No comments match this filter.</div>
      ) : (
        <ul className="cl-list">
          {filtered.map((a) => {
            const color = userColorMap.get(a.user_id) ?? SELF_ANNOTATION_COLOR;
            const isActive = a.id === activeId;
            const isEmphasized = !!emphasizedId && a.id === emphasizedId;
            const isEditing = a.id === editingId;
            const isOwn = a.user_id === selfUserId;
            return (
              <li
                key={a.id}
                data-testid={`list-card-${a.id}`}
                className={
                  'cl-card' +
                  (isActive ? ' active' : '') +
                  (isEmphasized ? ' share-arrival-emphasis' : '')
                }
                style={{ borderLeftColor: color }}
                onClick={() => onSelect(a)}
              >
                <div className="cl-card-meta">
                  <span className="cl-time" style={{ color }}>{timeText(a)}</span>
                  <span className="cl-author">{authorLabel(a)}</span>
                  {canEdit ? (
                    <button
                      type="button"
                      className={'cl-star' + (a.starred ? ' on' : '')}
                      aria-label={a.starred ? 'Unstar' : 'Star'}
                      title={a.starred ? 'Unstar this comment' : 'Star this comment to flag it for review'}
                      onClick={(e) => { e.stopPropagation(); onToggleStar(a); }}
                    ><Star size={14} strokeWidth={2} fill={a.starred ? 'currentColor' : 'none'} aria-hidden="true" /></button>
                  ) : (
                    a.starred && <span className="cl-star on" aria-hidden="true"><Star size={14} strokeWidth={2} fill="currentColor" aria-hidden="true" /></span>
                  )}
                  <div
                    className={'cl-overflow' + (menuOpenId === a.id ? ' open' : '')}
                    ref={menuOpenId === a.id ? menuRef : undefined}
                  >
                    <button
                      type="button"
                      className="cl-iconbtn cl-overflow-trigger"
                      aria-label="More actions"
                      aria-haspopup="menu"
                      aria-expanded={menuOpenId === a.id}
                      title="More actions"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId((cur) => (cur === a.id ? null : a.id));
                      }}
                    ><MoreHorizontal size={14} strokeWidth={2} aria-hidden="true" /></button>
                    {menuOpenId === a.id && (
                      <div className="cl-overflow-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          role="menuitem"
                          className="cl-overflow-item"
                          aria-label="Copy link to this comment"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId(null);
                            onCopyLink(a);
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
                                setMenuOpenId(null);
                                setEditBody(a.body);
                                setEditingId(a.id);
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
                                setMenuOpenId(null);
                                if (window.confirm('Delete this comment?')) onDelete(a);
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
                </div>
                {isEditing ? (
                  <div className="cl-edit" onClick={(e) => e.stopPropagation()}>
                    <textarea
                      autoFocus
                      rows={3}
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                        if (isSubmitShortcut(e) && editBody.trim().length > 0) {
                          e.preventDefault();
                          e.stopPropagation();
                          onSaveEdit(a, editBody.trim());
                          setEditingId(null);
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditingId(null);
                        }
                      }}
                    />
                    <div className="cl-edit-actions">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setEditingId(null); }}
                      >Cancel</button>
                      <button
                        type="button"
                        className="cl-save"
                        disabled={editBody.trim().length === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSaveEdit(a, editBody.trim());
                          setEditingId(null);
                        }}
                      >Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="cl-body">{a.body}</div>
                    <div className="cl-foot">
                      <Reactions
                        reactions={a.reactions}
                        isNarrow={isNarrow}
                        canReact={canReact}
                        onToggle={(emoji) =>
                          onToggleReaction({ kind: 'annotation', id: a.id }, emoji)
                        }
                      />
                      <ReplyThread
                        annotationId={a.id}
                        replyCount={a.reply_count}
                        replies={replies.get(a.id)}
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
