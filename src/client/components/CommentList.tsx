import { useMemo, useState } from 'react';
import type { Annotation } from '../../shared/types';
import { SELF_ANNOTATION_COLOR } from '../lib/colors';
import { fmt } from '../lib/format';

type Filter =
  | { kind: 'all' }
  | { kind: 'starred' }
  | { kind: 'mine' }
  | { kind: 'author'; userId: string };

type Props = {
  annotations: Annotation[];
  selfUserId: string;
  activeId: string | null;
  userColorMap: Map<string, string>;
  onSelect(annotation: Annotation): void;
};

function authorLabel(a: Annotation): string {
  return a.user_display_name ?? a.user_email;
}

function timeText(a: Annotation): string {
  return a.end_ms === null
    ? fmt(a.start_ms / 1000)
    : `${fmt(a.start_ms / 1000)} – ${fmt(a.end_ms / 1000)}`;
}

export function CommentList({
  annotations,
  selfUserId,
  activeId,
  userColorMap,
  onSelect,
}: Props) {
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });

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
        >★ Starred {starredCount}</button>
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
            return (
              <li
                key={a.id}
                data-testid={`list-card-${a.id}`}
                className={'cl-card' + (isActive ? ' active' : '')}
                style={{ borderLeftColor: color }}
                onClick={() => onSelect(a)}
              >
                <div className="cl-card-meta">
                  <span className="cl-time" style={{ color }}>{timeText(a)}</span>
                  <span className="cl-author">{authorLabel(a)}</span>
                  {a.starred && <span className="cl-starred" aria-hidden="true">★</span>}
                </div>
                <div className="cl-body">{a.body}</div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
