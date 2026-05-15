import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Tag, Trash2, X } from 'lucide-react';
import type { Section, Song } from '../../shared/types';
import { fmt } from '../lib/format';

export type SectionSubmit =
  | { kind: 'song_id'; song_id: string }
  | { kind: 'song_name'; song_name: string }
  | { kind: 'label'; label: string }
  | { kind: 'clear' };

type Props = {
  open: boolean;
  // Section being edited; null when creating a new one.
  section: Section | null;
  // Start time the popover represents — for the "Section at 1:23" header on
  // create, or the existing section's start_ms on edit.
  startMs: number;
  bandSongs: Song[];
  anchorLeftPx: number;
  anchorTopPx: number;
  onSubmit(payload: SectionSubmit): void;
  onDelete?(): void;
  onClose(): void;
};

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export function SectionPopover({
  open,
  section,
  startMs,
  bandSongs,
  anchorLeftPx,
  anchorTopPx,
  onSubmit,
  onDelete,
  onClose,
}: Props) {
  // The popover starts in the natural mode for the section being edited:
  // free-text sections open in label mode, others in song-pick mode. When
  // creating, default to song-pick.
  const [mode, setMode] = useState<'song' | 'label'>(() =>
    section?.label && !section.song_id ? 'label' : 'song',
  );
  const [text, setText] = useState<string>(() => {
    if (section?.song_name) return section.song_name;
    if (section?.label) return section.label;
    return '';
  });
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-seed when the popover is reopened against a different section.
  useEffect(() => {
    if (!open) return;
    setMode(section?.label && !section.song_id ? 'label' : 'song');
    setText(section?.song_name ?? section?.label ?? '');
    // Focus the input after the panel paints.
    queueMicrotask(() => inputRef.current?.focus());
  }, [open, section]);

  // Songs filtered by the current input, sorted by use_count desc. Exact
  // normalized matches float to the top.
  const matches = useMemo(() => {
    const q = normalize(text);
    if (!q) return [...bandSongs].slice(0, 8);
    const filtered = bandSongs.filter((s) =>
      normalize(s.name).includes(q),
    );
    filtered.sort((a, b) => {
      const an = normalize(a.name) === q ? 0 : 1;
      const bn = normalize(b.name) === q ? 0 : 1;
      if (an !== bn) return an - bn;
      return b.use_count - a.use_count;
    });
    return filtered.slice(0, 8);
  }, [text, bandSongs]);

  const exactMatch = useMemo<Song | null>(() => {
    const q = normalize(text);
    if (!q) return null;
    return bandSongs.find((s) => normalize(s.name) === q) ?? null;
  }, [text, bandSongs]);

  // Live "Will rename in N practices" hint when renaming an existing
  // song-backed section to a name that doesn't match its current song
  // (i.e. the rename will propagate or create a new song).
  const renamePropagation = useMemo<number | null>(() => {
    if (!section?.song_id || !section.song_name) return null;
    if (mode !== 'song') return null;
    if (normalize(text) === normalize(section.song_name)) return null;
    const currentSong = bandSongs.find((s) => s.id === section.song_id);
    if (!currentSong) return null;
    if (currentSong.use_count <= 1) return null;
    return currentSong.use_count;
  }, [text, section, bandSongs, mode]);

  if (!open) return null;

  function submit() {
    const trimmed = text.trim();
    if (mode === 'label') {
      if (!trimmed) {
        onSubmit({ kind: 'clear' });
      } else {
        onSubmit({ kind: 'label', label: trimmed });
      }
      return;
    }
    // Song mode. Prefer an exact existing match (case-insensitive) to
    // create-new, so the combobox never silently duplicates.
    if (!trimmed) {
      onSubmit({ kind: 'clear' });
      return;
    }
    if (exactMatch) {
      onSubmit({ kind: 'song_id', song_id: exactMatch.id });
    } else {
      onSubmit({ kind: 'song_name', song_name: trimmed });
    }
  }

  function pickSong(id: string) {
    onSubmit({ kind: 'song_id', song_id: id });
  }

  return (
    <div
      className="section-popover"
      role="dialog"
      aria-label={section ? 'Edit section' : 'Create section'}
      style={{ left: `${anchorLeftPx}px`, top: `${anchorTopPx}px` }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="sp-header">
        <span className="sp-title">
          {section ? 'Section' : 'New section'} at {fmt(startMs / 1000)}
        </span>
        <button
          type="button"
          className="sp-close"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <div className="sp-mode-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'song'}
          className={'sp-mode-tab' + (mode === 'song' ? ' active' : '')}
          onClick={() => setMode('song')}
        >Song</button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'label'}
          className={'sp-mode-tab' + (mode === 'label' ? ' active' : '')}
          onClick={() => setMode('label')}
        >Label</button>
      </div>
      <input
        ref={inputRef}
        type="text"
        className="sp-input"
        placeholder={
          mode === 'song'
            ? 'Search or create a song…'
            : 'Free-text marker (warmup, false start…)'
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        aria-label={mode === 'song' ? 'Song name' : 'Label'}
      />
      {renamePropagation !== null && (
        <div className="sp-rename-note" role="status">
          Will rename in {renamePropagation} practices.
        </div>
      )}
      {mode === 'song' && (
        <div className="sp-suggestions">
          {matches.map((s) => (
            <button
              type="button"
              key={s.id}
              className="sp-suggestion"
              data-testid={`sp-suggestion-${s.id}`}
              onClick={() => pickSong(s.id)}
            >
              <span className="sp-suggestion-name">{s.name}</span>
              {s.use_count > 0 && (
                <span className="sp-suggestion-count">
                  {s.use_count} practice{s.use_count === 1 ? '' : 's'}
                </span>
              )}
            </button>
          ))}
          {text.trim() && !exactMatch && (
            <button
              type="button"
              className="sp-suggestion sp-suggestion-create"
              onClick={submit}
            >
              <Plus size={14} strokeWidth={2} aria-hidden="true" />
              <span>Create song "{text.trim()}"</span>
            </button>
          )}
        </div>
      )}
      {mode === 'label' && (
        <div className="sp-hint">
          <Tag size={12} strokeWidth={2} aria-hidden="true" />
          <span>Labels are local to this practice — they don't appear in the catalog.</span>
        </div>
      )}
      <div className="sp-actions">
        {section && onDelete && (
          <button
            type="button"
            className="sp-action sp-action-danger"
            onClick={onDelete}
          >
            <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
            Delete section
          </button>
        )}
        <span className="sp-actions-spacer" />
        <button
          type="button"
          className="sp-action"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="sp-action sp-action-primary"
          onClick={submit}
        >
          {section ? 'Save' : 'Add section'}
        </button>
      </div>
    </div>
  );
}
