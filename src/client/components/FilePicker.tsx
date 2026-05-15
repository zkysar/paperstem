import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, Pencil, Trash2, X } from 'lucide-react';
import type { Project, TrashList } from '../data/types';
import type { Song } from '../../shared/types';
import { AUDIO_EXT } from '../lib/audio';
import { colorForSong } from '../lib/colors';
import { WaveformThumb } from './WaveformThumb';

type Tab = 'recent' | 'all' | 'trash';

type Props = {
  open: boolean;
  loading: boolean;
  loadError: string | null;
  projects: Project[];
  activeProjectId: string | null;
  showUpload: boolean;
  // Song catalog + per-project usage backs the chip-rail filter above the
  // project list. Filtering is purely client-side (one usage fetch per band
  // is cheaper than re-fetching projects per chip).
  bandSongs: Song[];
  songUsage: { project_id: string; song_id: string }[];
  filterSongId: string | null;
  onSetFilterSongId(id: string | null): void;
  onClose(): void;
  onSelect(id: string): void;
  onLoadFolder(files: File[], folderName: string): void;
  onRetry(): void;
  onRenameProject(id: string, name: string): void;
  onDeleteProject(id: string): void;
  trash: TrashList | null;
  trashError: string | null;
  onLoadTrash(): void;
  onRestoreProject(id: string): void;
  onRestoreStem(id: string): void;
};

export function FilePicker({
  open, loading, loadError, projects, activeProjectId, showUpload,
  bandSongs, songUsage, filterSongId, onSetFilterSongId,
  onClose, onSelect, onLoadFolder, onRetry,
  onRenameProject, onDeleteProject,
  trash, trashError, onLoadTrash, onRestoreProject, onRestoreStem,
}: Props) {
  const [tab, setTab] = useState<Tab>('recent');
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Set of project IDs that contain the active song filter. When no
  // filter is set, the original projects pass through untouched.
  const filteredProjects = useMemo<Project[]>(() => {
    if (!filterSongId) return projects;
    const allowed = new Set(
      songUsage
        .filter((u) => u.song_id === filterSongId)
        .map((u) => u.project_id),
    );
    return projects.filter((p) => allowed.has(p.id));
  }, [projects, songUsage, filterSongId]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // If a confirm modal is open, Esc dismisses just that modal — keep
        // the picker open so the user doesn't lose context after backing out.
        if (confirm) {
          setConfirm(null);
          return;
        }
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, confirm]);

  if (!open) return null;

  function onFolderPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const all = Array.from(e.target.files ?? []);
    const audio = all.filter((f) => AUDIO_EXT.test(f.name));
    audio.sort((a, b) => a.name.localeCompare(b.name));
    if (!audio.length) {
      onLoadFolder([], '');
    } else {
      const rel = audio[0].webkitRelativePath || audio[0].name;
      const folderName = rel.split('/')[0] || 'Local folder';
      onLoadFolder(audio, folderName);
    }
    if (folderInputRef.current) folderInputRef.current.value = '';
  }

  return (
    <>
      <div
        className="filepicker-scrim"
        data-testid="filepicker-scrim"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="filepicker" role="dialog" aria-modal="true" aria-label="Projects">
        <div className="fp-header">
          <h2 className="fp-title">Projects</h2>
          <input
            type="search"
            className="fp-search"
            placeholder="Search projects"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {showUpload && (
            <button
              type="button"
              className="fp-upload-btn"
              onClick={() => folderInputRef.current?.click()}
            >
              <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
              New project
            </button>
          )}
          <button
            type="button"
            className="fp-close"
            onClick={onClose}
            aria-label="Close picker"
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div className="fp-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'recent'}
            className={'fp-tab' + (tab === 'recent' ? ' active' : '')}
            onClick={() => setTab('recent')}
          >Recent</button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'all'}
            className={'fp-tab' + (tab === 'all' ? ' active' : '')}
            onClick={() => setTab('all')}
          >All</button>
          <button
            type="button"
            role="tab"
            data-tab="trash"
            aria-selected={tab === 'trash'}
            className={'fp-tab' + (tab === 'trash' ? ' active' : '')}
            onClick={() => {
              setTab('trash');
              if (trash === null) onLoadTrash();
            }}
          >Trash</button>
        </div>
        <input
          ref={folderInputRef}
          type="file"
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          multiple hidden onChange={onFolderPicked}
        />
        {tab !== 'trash' && bandSongs.length > 0 && (
          <div className="fp-song-rail" role="toolbar" aria-label="Filter by song">
            <span className="fp-song-rail-label">Songs</span>
            {bandSongs
              .filter((s) => s.use_count > 0)
              .map((s) => {
                const isActive = filterSongId === s.id;
                return (
                  <button
                    type="button"
                    key={s.id}
                    data-testid={`fp-song-chip-${s.id}`}
                    className={'fp-song-chip' + (isActive ? ' active' : '')}
                    aria-pressed={isActive}
                    onClick={() =>
                      onSetFilterSongId(isActive ? null : s.id)
                    }
                  >
                    <span
                      className="fp-song-chip-swatch"
                      style={{ background: colorForSong(s.id) }}
                      aria-hidden="true"
                    />
                    <span>{s.name}</span>
                    <span className="fp-song-chip-count">
                      {s.use_count}
                    </span>
                  </button>
                );
              })}
            {filterSongId && (
              <button
                type="button"
                className="fp-song-chip-clear"
                onClick={() => onSetFilterSongId(null)}
              >
                Clear filter
              </button>
            )}
          </div>
        )}
        {tab === 'trash' ? (
          <TrashBody
            trash={trash}
            trashError={trashError}
            onRetry={onLoadTrash}
            onRestoreProject={onRestoreProject}
            onRestoreStem={onRestoreStem}
          />
        ) : (
          <FilePickerBody
            tab={tab} search={search}
            loading={loading} loadError={loadError}
            projects={filteredProjects} activeProjectId={activeProjectId}
            showUpload={showUpload}
            onSelect={onSelect}
            onNewProjectClick={() => folderInputRef.current?.click()}
            onRetry={onRetry}
            onRenameProject={onRenameProject}
            onRequestDelete={(id, name) => setConfirm({ id, name })}
          />
        )}
        {showUpload && tab !== 'trash' && (
          <div className="fp-upload-bottom">
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
            >
              <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
              New project
            </button>
          </div>
        )}
        {confirm && (
          <div
            className="fp-modal-scrim"
            role="presentation"
            onClick={() => setConfirm(null)}
          >
            <div
              className="fp-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="fp-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="fp-modal-title">Move "{confirm.name}" to trash?</h3>
              <p>You can restore from this band's trash for 30 days.</p>
              <div className="fp-modal-actions">
                <button
                  type="button"
                  autoFocus
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    onDeleteProject(confirm.id);
                    setConfirm(null);
                  }}
                >
                  Move to trash
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function FilePickerBody({
  search, projects, activeProjectId, loading, loadError, showUpload,
  onSelect, onNewProjectClick, onRetry, onRenameProject, onRequestDelete,
}: {
  tab: Tab;
  search: string;
  loading: boolean;
  loadError: string | null;
  projects: Project[];
  activeProjectId: string | null;
  showUpload: boolean;
  onSelect(id: string): void;
  onNewProjectClick(): void;
  onRetry(): void;
  onRenameProject(id: string, name: string): void;
  onRequestDelete(id: string, name: string): void;
}) {
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);

  function commitEdit(id: string) {
    if (!editing || editing.id !== id) return;
    const next = editing.draft.trim();
    setEditing(null);
    const original = projects.find((p) => p.id === id);
    if (!next || next === original?.title) return;
    onRenameProject(id, next);
  }
  if (loadError) {
    return (
      <div className="fp-body fp-state">
        <p className="fp-state-msg">Couldn't load projects ({loadError}).</p>
        <button type="button" className="fp-state-action" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="fp-body">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} data-testid="fp-row-skeleton" className="fp-row fp-row-skeleton">
            <span className="fp-skel fp-skel-name" />
            <span className="fp-skel fp-skel-thumb" />
            <span className="fp-skel fp-skel-meta" />
            <span className="fp-skel fp-skel-meta" />
            <span></span>
          </div>
        ))}
      </div>
    );
  }
  if (projects.length === 0) {
    return (
      <div className="fp-body fp-state">
        <p className="fp-state-msg">No projects yet.</p>
        {showUpload && (
          <button type="button" className="fp-state-action" onClick={onNewProjectClick}>
            <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
            New project
          </button>
        )}
        <p className="fp-state-secondary">
          Pick a folder of stems. You can listen and rename before saving it
          to your band.
        </p>
      </div>
    );
  }

  const filtered = projects.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.title.toLowerCase().includes(q) ||
      (p.folder ?? '').toLowerCase().includes(q)
    );
  });
  // Default sort: name desc (matches existing date-coded titles)
  const rows = [...filtered].sort((a, b) => b.title.localeCompare(a.title));

  return (
    <div className="fp-body">
      <div className="fp-row fp-row-head" role="row">
        <span>Name</span>
        <span>Waveform</span>
        <span>Date</span>
        <span>Stems</span>
        <span></span>
      </div>
      {rows.map((p) => {
        const isEditing = editing?.id === p.id;
        return (
          <div
            key={p.id}
            data-testid={`fp-row-${p.id}`}
            className={'fp-row fp-row-data' + (p.id === activeProjectId ? ' active' : '')}
          >
            {isEditing ? (
              <div className="fp-row-main fp-row-main-editing">
                <input
                  className="fp-name-input"
                  aria-label="Rename project"
                  autoFocus
                  value={editing!.draft}
                  onChange={(e) => setEditing({ id: p.id, draft: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitEdit(p.id);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setEditing(null);
                    }
                  }}
                  onBlur={() => commitEdit(p.id)}
                  onClick={(e) => e.stopPropagation()}
                />
                <WaveformThumb stemId={p.referenceStemId} />
                <span className="fp-meta">{p.folder ?? ''}</span>
                <span className="fp-meta">{p.stemCount}</span>
              </div>
            ) : (
              <button
                type="button"
                className="fp-row-main"
                onClick={() => onSelect(p.id)}
              >
                <span className="fp-name">{p.title}</span>
                <WaveformThumb stemId={p.referenceStemId} />
                <span className="fp-meta">{p.folder ?? ''}</span>
                <span className="fp-meta">{p.stemCount}</span>
              </button>
            )}
            <span className="fp-row-end">
              {!isEditing && (
                <button
                  type="button"
                  className="fp-rename-btn"
                  aria-label={`Rename ${p.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing({ id: p.id, draft: p.title });
                  }}
                  title="Rename"
                >
                  <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
              {!isEditing && (
                <button
                  type="button"
                  className="fp-trash-btn"
                  aria-label={`Move ${p.title} to trash`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequestDelete(p.id, p.title);
                  }}
                  title="Move to trash"
                >
                  <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TrashBody({
  trash, trashError, onRetry, onRestoreProject, onRestoreStem,
}: {
  trash: TrashList | null;
  trashError: string | null;
  onRetry(): void;
  onRestoreProject(id: string): void;
  onRestoreStem(id: string): void;
}) {
  if (trashError) {
    return (
      <div className="fp-body fp-state">
        <p className="fp-state-msg">Couldn't load trash ({trashError}).</p>
        <button type="button" className="fp-state-action" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (!trash) {
    return (
      <div className="fp-body fp-state">
        <p className="fp-state-msg">Loading…</p>
      </div>
    );
  }
  if (!trash.projects.length && !trash.stems.length) {
    return (
      <div className="fp-body fp-state">
        <p className="fp-state-msg">Trash is empty.</p>
      </div>
    );
  }
  return (
    <div className="fp-body">
      <div className="fp-row fp-row-head" role="row">
        <span>Name</span>
        <span>Type</span>
        <span>Deleted by</span>
        <span>Status</span>
        <span></span>
      </div>
      {trash.projects.map((p) => (
        <div key={`p-${p.id}`} className="fp-row fp-row-data">
          <span className="fp-name">{p.name}</span>
          <span className="fp-meta">Project</span>
          <span className="fp-meta">{p.deleted_by_email ?? '—'}</span>
          <span className="fp-meta">
            {p.deleted_reason === 'drive_missing' ? 'File missing' : ''}
          </span>
          <button
            type="button"
            aria-label={`Restore ${p.name}`}
            disabled={p.deleted_reason === 'drive_missing'}
            onClick={() => onRestoreProject(p.id)}
          >
            Restore
          </button>
        </div>
      ))}
      {trash.stems.map((s) => (
        <div key={`s-${s.id}`} className="fp-row fp-row-data">
          <span className="fp-name">{s.name}</span>
          <span className="fp-meta">Stem · {s.project_name}</span>
          <span className="fp-meta">{s.deleted_by_email ?? '—'}</span>
          <span className="fp-meta">
            {s.deleted_reason === 'drive_missing' ? 'File missing' : ''}
          </span>
          <button
            type="button"
            aria-label={`Restore ${s.name}`}
            disabled={s.deleted_reason === 'drive_missing'}
            onClick={() => onRestoreStem(s.id)}
          >
            Restore
          </button>
        </div>
      ))}
    </div>
  );
}
