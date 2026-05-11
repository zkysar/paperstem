import { useEffect, useState, type KeyboardEvent } from 'react';
import type { Annotation } from '../../shared/types';
import { CommentList } from './CommentList';
import { fmt } from '../lib/format';
import { isMac } from '../lib/platform';

export type DraftSpec = { start_ms: number; end_ms: number | null };

type Props = {
  open: boolean;
  isNarrow: boolean;
  selfUserId: string;
  canEdit: boolean;
  annotations: Annotation[];
  userColorMap: Map<string, string>;
  activeId: string | null;
  pendingDraft: DraftSpec | null;
  onClose(): void;
  onSelect(annotation: Annotation): void;
  onCreate(body: string): void;
  onDraftCancel(): void;
};

const SUBMIT_HINT = isMac ? '⌘↵' : 'Ctrl+↵';

function isSubmitShortcut(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (e.key !== 'Enter') return false;
  return isMac ? e.metaKey : e.ctrlKey;
}

export function CommentsDrawer({
  open, isNarrow, selfUserId, canEdit,
  annotations, userColorMap, activeId, pendingDraft,
  onClose, onSelect, onCreate, onDraftCancel,
}: Props) {
  const [draftBody, setDraftBody] = useState('');

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
              onClick={onClose}
            >‹</button>
          )}
          <h2 className="cd-title">All comments</h2>
          <span className="cd-count">· {annotations.length}</span>
          {!isNarrow && (
            <button
              type="button"
              className="cd-close"
              aria-label="Close"
              onClick={onClose}
            >✕</button>
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
              }}
            />
            <div className="cd-draft-actions">
              <button type="button" onClick={onDraftCancel}>Cancel</button>
              <button
                type="button"
                className="cd-save"
                disabled={draftBody.trim().length === 0}
                onClick={handleSaveDraft}
              >Save ({SUBMIT_HINT})</button>
            </div>
          </div>
        )}

        <CommentList
          annotations={annotations}
          selfUserId={selfUserId}
          activeId={activeId}
          userColorMap={userColorMap}
          onSelect={onSelect}
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
