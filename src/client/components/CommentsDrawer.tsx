import { useEffect, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import type {
  Annotation,
  AnnotationReply,
  ReactionTarget,
} from '../../shared/types';
import { CommentList } from './CommentList';
import { fmt } from '../lib/format';
import { isMac } from '../lib/platform';
import { useIsMobile } from '../hooks/useIsMobile';

export type DraftSpec = { start_ms: number; end_ms: number | null };

type Props = {
  open: boolean;
  isNarrow: boolean;
  selfUserId: string;
  selfDisplayName: string;
  selfColor: string;
  canEdit: boolean;
  canReact?: boolean;
  annotations: Annotation[];
  userColorMap: Map<string, string>;
  activeId: string | null;
  emphasizedId?: string | null;
  pendingDraft: DraftSpec | null;
  onClose(): void;
  onSelect(annotation: Annotation): void;
  onCreate(body: string): void;
  onDraftCancel(): void;
  onToggleStar(annotation: Annotation): void;
  onSaveEdit(annotation: Annotation, body: string): void;
  onDelete(annotation: Annotation): void;
  onCopyLink(annotation: Annotation): void;
  replies: Map<string, AnnotationReply[]>;
  onLoadReplies(annotationId: string): Promise<void> | void;
  onCreateReply(annotationId: string, body: string): Promise<void> | void;
  onEditReply(replyId: string, body: string): Promise<void> | void;
  onDeleteReply(annotationId: string, replyId: string): Promise<void> | void;
  onToggleReaction(target: ReactionTarget, emoji: string): void;
};

const SUBMIT_HINT = isMac() ? '⌘↵' : 'Ctrl+↵';

function isSubmitShortcut(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (e.key !== 'Enter') return false;
  return isMac() ? e.metaKey : e.ctrlKey;
}

export function CommentsDrawer({
  open, isNarrow, selfUserId, selfDisplayName, selfColor, canEdit, canReact = true,
  annotations, userColorMap, activeId, emphasizedId, pendingDraft,
  onClose, onSelect, onCreate, onDraftCancel,
  onToggleStar, onSaveEdit, onDelete, onCopyLink,
  replies, onLoadReplies, onCreateReply, onEditReply, onDeleteReply,
  onToggleReaction,
}: Props) {
  const [draftBody, setDraftBody] = useState('');
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!pendingDraft) setDraftBody('');
  }, [pendingDraft]);

  if (!open) return null;

  function handleSaveDraft() {
    const text = draftBody.trim();
    if (!text) return;
    onCreate(text);
  }

  const draftMeta = pendingDraft && (
    <>
      New {pendingDraft.end_ms === null ? 'point' : 'region'} at{' '}
      {fmt(pendingDraft.start_ms / 1000)}
      {pendingDraft.end_ms !== null
        ? ` – ${fmt(pendingDraft.end_ms / 1000)}`
        : ''}
    </>
  );

  return (
    <>
      {!isNarrow && (
        <div
          data-testid="comments-drawer-backdrop"
          className="comments-drawer-backdrop"
          onPointerDown={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-hidden="true"
        />
      )}
      <aside
        className={'comments-drawer' + (isNarrow ? ' narrow' : '')}
        role="dialog"
        aria-label="All comments"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="cd-head">
          {isNarrow && (
            <button
              type="button"
              className="cd-back"
              aria-label="Back"
              title="Back"
              onClick={onClose}
            ><ChevronLeft size={16} strokeWidth={2} aria-hidden="true" /></button>
          )}
          <h2 className="cd-title">All comments</h2>
          <span className="cd-count">· {annotations.length}</span>
          {!isNarrow && (
            <button
              type="button"
              className="cd-close"
              aria-label="Close"
              title="Close the comments panel"
              onClick={onClose}
            ><X size={16} strokeWidth={2} aria-hidden="true" /></button>
          )}
        </header>

        {canEdit && pendingDraft && (
          <div className="cd-draft">
            <div className="cd-draft-meta">{draftMeta}</div>
            <textarea
              autoFocus
              rows={3}
              value={draftBody}
              placeholder="Write a note…"
              onChange={(e) => setDraftBody(e.target.value)}
              onKeyDown={(e) => {
                if (isSubmitShortcut(e) && draftBody.trim().length > 0) {
                  e.preventDefault();
                  handleSaveDraft();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  onDraftCancel();
                }
              }}
            />
            <div className="cd-draft-actions">
              <button type="button" onClick={onDraftCancel}>Cancel</button>
              <button
                type="button"
                className="cd-save"
                disabled={draftBody.trim().length === 0}
                onClick={handleSaveDraft}
              >{isMobile ? 'Save' : `Save (${SUBMIT_HINT})`}</button>
            </div>
          </div>
        )}

        <CommentList
          annotations={annotations}
          selfUserId={selfUserId}
          selfDisplayName={selfDisplayName}
          selfColor={selfColor}
          activeId={activeId}
          emphasizedId={emphasizedId ?? null}
          userColorMap={userColorMap}
          canEdit={canEdit}
          canReact={canReact}
          isNarrow={isNarrow}
          onSelect={onSelect}
          onToggleStar={onToggleStar}
          onSaveEdit={onSaveEdit}
          onDelete={onDelete}
          onCopyLink={onCopyLink}
          replies={replies}
          onLoadReplies={onLoadReplies}
          onCreateReply={onCreateReply}
          onEditReply={onEditReply}
          onDeleteReply={onDeleteReply}
          onToggleReaction={onToggleReaction}
        />

        {!isNarrow && !pendingDraft && (
          <div className="cd-foot">
            drag a region on the timeline to add a comment
          </div>
        )}
      </aside>
    </>
  );
}
