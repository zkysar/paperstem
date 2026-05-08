import { useEffect, useState } from 'react';
import type { Annotation } from '../../shared/types';
import {
  createAnnotation,
  deleteAnnotation,
  patchAnnotation,
} from '../data/annotations-repo';
import { SELF_ANNOTATION_COLOR } from '../lib/colors';
import { fmt } from '../lib/format';

type Props = {
  open: boolean;
  projectId: string | null;
  selfUserId: string;
  canEdit: boolean;
  annotations: Annotation[];
  userColorMap: Map<string, string>;
  markersVisible: boolean;
  pendingDraft: AnnotationDraft | null;
  highlightId: string | null;
  onClose(): void;
  onSeek(seconds: number): void;
  onAnnotationsChange(next: Annotation[]): void;
  onDraftCancel(): void;
  onToggleMarkersVisible(): void;
  onLoopAnnotation(annotation: Annotation): void;
};

const IS_MAC =
  typeof navigator !== 'undefined' &&
  navigator.platform.toUpperCase().includes('MAC');
const SUBMIT_HINT = IS_MAC ? '⌘↵' : 'Ctrl+↵';

function isSubmitShortcut(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (e.key !== 'Enter') return false;
  return IS_MAC ? e.metaKey : e.ctrlKey;
}

export type AnnotationDraft = {
  start_ms: number;
  end_ms: number | null;
};

function formatRange(a: Annotation): string {
  const startSec = a.start_ms / 1000;
  if (a.end_ms === null) return fmt(startSec);
  return `${fmt(startSec)} – ${fmt(a.end_ms / 1000)}`;
}

function authorLabel(a: Annotation): string {
  return a.user_display_name ?? a.user_email;
}

export function AnnotationsDrawer({
  open,
  projectId,
  selfUserId,
  canEdit,
  annotations,
  userColorMap,
  markersVisible,
  pendingDraft,
  highlightId,
  onClose,
  onSeek,
  onAnnotationsChange,
  onDraftCancel,
  onToggleMarkersVisible,
  onLoopAnnotation,
}: Props) {
  const [draftBody, setDraftBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  useEffect(() => {
    if (!pendingDraft) {
      setDraftBody('');
      setError(null);
    }
  }, [pendingDraft]);

  if (!open) return null;

  async function handleSaveDraft() {
    if (!projectId || !pendingDraft) return;
    const text = draftBody.trim();
    if (!text) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createAnnotation(projectId, {
        start_ms: pendingDraft.start_ms,
        end_ms: pendingDraft.end_ms,
        body: text,
      });
      const next = [...annotations, created].sort(
        (a, b) => a.start_ms - b.start_ms || a.created_at - b.created_at,
      );
      onAnnotationsChange(next);
      setDraftBody('');
      onDraftCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(annotation: Annotation) {
    if (!window.confirm('Delete this annotation?')) return;
    try {
      await deleteAnnotation(annotation.id);
      onAnnotationsChange(annotations.filter((a) => a.id !== annotation.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleToggleStar(annotation: Annotation) {
    const optimistic = annotations.map((a) =>
      a.id === annotation.id ? { ...a, starred: !a.starred } : a,
    );
    onAnnotationsChange(optimistic);
    try {
      const updated = await patchAnnotation(annotation.id, {
        starred: !annotation.starred,
      });
      onAnnotationsChange(
        optimistic.map((a) => (a.id === updated.id ? updated : a)),
      );
    } catch (err) {
      onAnnotationsChange(annotations);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function startEdit(annotation: Annotation) {
    setEditingId(annotation.id);
    setEditBody(annotation.body);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditBody('');
  }

  async function saveEdit(annotation: Annotation) {
    const text = editBody.trim();
    if (!text) return;
    try {
      const updated = await patchAnnotation(annotation.id, { body: text });
      onAnnotationsChange(
        annotations.map((a) => (a.id === updated.id ? updated : a)),
      );
      cancelEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <aside className="annotations-drawer" aria-label="Annotations">
      <div className="annotations-drawer-header">
        <h2>Annotations</h2>
        <label className="annotations-markers-toggle" title="Show markers on the timeline">
          <input
            type="checkbox"
            checked={markersVisible}
            onChange={onToggleMarkersVisible}
          />
          <span>Show on timeline</span>
        </label>
        <button
          type="button"
          className="annotations-drawer-close"
          aria-label="Close annotations"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      {error && (
        <div className="annotations-error" role="alert">
          {error}
        </div>
      )}

      {canEdit && pendingDraft && (
        <div className="annotation-draft">
          <div className="annotation-draft-meta">
            New {pendingDraft.end_ms === null ? 'point' : 'region'} at{' '}
            {fmt(pendingDraft.start_ms / 1000)}
            {pendingDraft.end_ms !== null
              ? ` – ${fmt(pendingDraft.end_ms / 1000)}`
              : ''}
          </div>
          <textarea
            autoFocus
            value={draftBody}
            placeholder="Write a note…"
            onChange={(e) => setDraftBody(e.target.value)}
            onKeyDown={(e) => {
              if (isSubmitShortcut(e) && draftBody.trim().length > 0 && !submitting) {
                e.preventDefault();
                void handleSaveDraft();
              }
            }}
            disabled={submitting}
            rows={3}
          />
          <div className="annotation-draft-actions">
            <button
              type="button"
              onClick={onDraftCancel}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="annotation-save"
              onClick={() => void handleSaveDraft()}
              disabled={submitting || draftBody.trim().length === 0}
            >
              {submitting ? 'Saving…' : `Save (${SUBMIT_HINT})`}
            </button>
          </div>
        </div>
      )}

      {annotations.length === 0 && !pendingDraft && (
        <div className="annotations-empty">No annotations yet.</div>
      )}

      <ul className="annotations-list">
        {annotations.map((a) => {
          const color = userColorMap.get(a.user_id) ?? SELF_ANNOTATION_COLOR;
          const isOwn = a.user_id === selfUserId;
          const isHighlighted = a.id === highlightId;
          const isEditing = editingId === a.id;
          return (
            <li
              key={a.id}
              className={
                'annotation-row' +
                (isHighlighted ? ' highlighted' : '') +
                (isOwn ? ' own' : '')
              }
              style={{ borderLeftColor: color }}
              onClick={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest('button, textarea, input')) return;
                onSeek(a.start_ms / 1000);
              }}
            >
              <div className="annotation-row-header">
                <span
                  className={
                    'annotation-kind ' + (a.end_ms === null ? 'point' : 'region')
                  }
                  style={{ color }}
                  aria-label={a.end_ms === null ? 'point annotation' : 'region annotation'}
                  title={a.end_ms === null ? 'Point annotation' : 'Region annotation'}
                >
                  {a.end_ms === null ? '●' : '▭'}
                </span>
                <span className="annotation-time">{formatRange(a)}</span>
                <span
                  className="annotation-author"
                  style={{ color }}
                  title={a.user_email}
                >
                  {authorLabel(a)}
                </span>
                {a.end_ms !== null && (
                  <button
                    type="button"
                    className="annotation-loop"
                    aria-label="Loop this region"
                    title="Loop this region"
                    onClick={(e) => {
                      e.stopPropagation();
                      onLoopAnnotation(a);
                    }}
                  >
                    ⟲
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    className={
                      'annotation-star' + (a.starred ? ' starred' : '')
                    }
                    aria-label={a.starred ? 'Unstar' : 'Star'}
                    onClick={() => void handleToggleStar(a)}
                  >
                    {a.starred ? '★' : '☆'}
                  </button>
                )}
                {!canEdit && a.starred && (
                  <span className="annotation-star starred" aria-hidden="true">
                    ★
                  </span>
                )}
              </div>
              {isEditing ? (
                <div className="annotation-edit">
                  <textarea
                    autoFocus
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (isSubmitShortcut(e) && editBody.trim().length > 0) {
                        e.preventDefault();
                        void saveEdit(a);
                      }
                    }}
                    rows={3}
                  />
                  <div className="annotation-draft-actions">
                    <button type="button" onClick={cancelEdit}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="annotation-save"
                      disabled={editBody.trim().length === 0}
                      onClick={() => void saveEdit(a)}
                    >
                      {`Save (${SUBMIT_HINT})`}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="annotation-body">{a.body}</div>
              )}
              {canEdit && isOwn && !isEditing && (
                <div className="annotation-row-actions">
                  <button
                    type="button"
                    className="annotation-icon-btn"
                    aria-label="Edit"
                    onClick={() => startEdit(a)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="annotation-icon-btn"
                    aria-label="Delete"
                    onClick={() => void handleDelete(a)}
                  >
                    🗑
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
