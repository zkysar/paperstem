import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, FolderOpen, MessageSquare, MoreVertical, Pencil, Trash2, X } from 'lucide-react';
import type { Project, TrashList } from '../data/types';
import type { Song } from '../../shared/types';
import { AUDIO_EXT } from '../lib/audio';
import { colorForSong } from '../lib/colors';
import { formatDurationMs, formatRelativeDate } from '../lib/format';
import { WaveformThumb } from './WaveformThumb';

type SortKey = 'name' | 'updated' | 'duration' | 'stems' | 'comments';
type SortDir = 'asc' | 'desc';

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
          {/* Trash demoted from a peer tab to a quiet icon at the right edge —
              a once-a-month destination shouldn't crowd the primary filters. */}
          <button
            type="button"
            role="tab"
            data-tab="trash"
            aria-selected={tab === 'trash'}
            aria-label="Trash"
            title="Trash"
            className={'fp-tab fp-tab-trash' + (tab === 'trash' ? ' active' : '')}
            onClick={() => {
              const next: Tab = tab === 'trash' ? 'recent' : 'trash';
              setTab(next);
              if (next === 'trash' && trash === null) onLoadTrash();
            }}
          >
            <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
          </button>
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
              <p>Items in trash can be restored for 30 days.</p>
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
  // Default sort matches the server's intent ("recently touched first").
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: 'updated', dir: 'desc',
  });

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (prev.key !== key) {
        // First click on a new column: default to desc for date/numeric (most
        // useful), asc for name (alphabetical).
        return { key, dir: key === 'name' ? 'asc' : 'desc' };
      }
      return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
    });
  }

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
            <span className="fp-cell-name fp-skel fp-skel-name" />
            <span className="fp-cell-thumb fp-skel fp-skel-thumb" />
            <span className="fp-cell-date fp-skel fp-skel-meta" />
            <span className="fp-cell-duration fp-skel fp-skel-meta" />
            <span className="fp-cell-stems fp-skel fp-skel-meta" />
            <span className="fp-cell-comments fp-skel fp-skel-meta" />
            <span className="fp-cell-actions" />
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
          Pick a folder of stems. You can listen and rename before saving it.
        </p>
      </div>
    );
  }

  const filtered = projects.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.title.toLowerCase().includes(q);
  });
  const rows = sortProjects(filtered, sort);

  return (
    <div className="fp-body">
      <div className="fp-row fp-row-head" role="row">
        <SortHeader className="fp-cell-name" label="Name" sortKey="name" sort={sort} onClick={toggleSort} />
        <span className="fp-cell-thumb">Waveform</span>
        <SortHeader className="fp-cell-date" label="Updated" sortKey="updated" sort={sort} onClick={toggleSort} />
        <SortHeader className="fp-cell-duration" label="Length" sortKey="duration" sort={sort} onClick={toggleSort} />
        <SortHeader className="fp-cell-stems" label="Stems" sortKey="stems" sort={sort} onClick={toggleSort} />
        <SortHeader className="fp-cell-comments" label="Comments" sortKey="comments" sort={sort} onClick={toggleSort} />
        <span className="fp-cell-actions" />
      </div>
      {rows.map((p) => (
        <ProjectRow
          key={p.id}
          project={p}
          active={p.id === activeProjectId}
          editing={editing?.id === p.id ? editing.draft : null}
          onSelect={() => onSelect(p.id)}
          onStartRename={() => setEditing({ id: p.id, draft: p.title })}
          onChangeDraft={(draft) => setEditing({ id: p.id, draft })}
          onCommitRename={() => commitEdit(p.id)}
          onCancelRename={() => setEditing(null)}
          onRequestDelete={() => onRequestDelete(p.id, p.title)}
        />
      ))}
    </div>
  );
}

function SortHeader({
  className, label, sortKey, sort, onClick,
}: {
  className: string;
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onClick(key: SortKey): void;
}) {
  const active = sort.key === sortKey;
  return (
    <button
      type="button"
      className={className + ' fp-sort-btn' + (active ? ' active' : '')}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => onClick(sortKey)}
    >
      {label}
      {active && (sort.dir === 'asc'
        ? <ChevronUp size={12} strokeWidth={2.5} aria-hidden="true" />
        : <ChevronDown size={12} strokeWidth={2.5} aria-hidden="true" />)}
    </button>
  );
}

function sortProjects(
  list: Project[],
  sort: { key: SortKey; dir: SortDir },
): Project[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const cmp = (a: Project, b: Project): number => {
    switch (sort.key) {
      case 'name':     return sign * a.title.localeCompare(b.title);
      case 'updated':  return sign * (a.updatedAt - b.updatedAt);
      case 'duration': return sign * ((a.totalDurationMs ?? 0) - (b.totalDurationMs ?? 0));
      case 'stems':    return sign * (a.stemCount - b.stemCount);
      case 'comments': return sign * (a.commentCount - b.commentCount);
    }
  };
  return [...list].sort(cmp);
}

function ProjectRow({
  project: p, active, editing,
  onSelect, onStartRename, onChangeDraft, onCommitRename, onCancelRename,
  onRequestDelete,
}: {
  project: Project;
  active: boolean;
  editing: string | null;
  onSelect(): void;
  onStartRename(): void;
  onChangeDraft(draft: string): void;
  onCommitRename(): void;
  onCancelRename(): void;
  onRequestDelete(): void;
}) {
  const isEditing = editing !== null;
  const date = formatRelativeDate(p.updatedAt);
  const duration = formatDurationMs(p.totalDurationMs);
  const stemsLabel = `${p.stemCount} ${p.stemCount === 1 ? 'stem' : 'stems'}`;
  const commentsLabel = p.commentCount > 0
    ? `${p.commentCount} ${p.commentCount === 1 ? 'comment' : 'comments'}`
    : '';
  // Mobile-only meta string. Empty fields are filtered so we don't leave
  // double or trailing " · " separators.
  const metaLine = [stemsLabel, duration, commentsLabel, date]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      data-testid={`fp-row-${p.id}`}
      className={'fp-row fp-row-data' + (active ? ' active' : '')}
    >
      {isEditing ? (
        // display:contents — children become direct grid items so cell
        // placement is identical to the non-editing layout.
        <div className="fp-row-main fp-row-main-editing">
          <input
            className="fp-cell-name fp-name-input"
            aria-label="Rename project"
            autoFocus
            value={editing!}
            onChange={(e) => onChangeDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); onCommitRename(); }
              else if (e.key === 'Escape') { e.preventDefault(); onCancelRename(); }
            }}
            onBlur={onCommitRename}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="fp-cell-thumb"><WaveformThumb stemId={p.referenceStemId} /></span>
          <span className="fp-cell-date fp-meta">{date}</span>
          <span className="fp-cell-duration fp-meta">{duration}</span>
          <span className="fp-cell-stems fp-meta">{p.stemCount}</span>
          <span className="fp-cell-comments fp-meta">{p.commentCount > 0 ? p.commentCount : ''}</span>
          <span className="fp-cell-meta fp-meta">{metaLine}</span>
        </div>
      ) : (
        <button
          type="button"
          className="fp-row-main"
          onClick={onSelect}
        >
          <span className="fp-cell-name fp-name">{p.title}</span>
          <span className="fp-cell-thumb"><WaveformThumb stemId={p.referenceStemId} /></span>
          <span className="fp-cell-date fp-meta">{date}</span>
          <span className="fp-cell-duration fp-meta">{duration}</span>
          <span className="fp-cell-stems fp-meta">{p.stemCount}</span>
          <span
            className="fp-cell-comments fp-meta"
            // Only announce when there are comments — "0 comments" on every
            // empty project would be noise.
            aria-label={p.commentCount > 0 ? commentsLabel : undefined}
          >
            {p.commentCount > 0 && (
              <>
                <MessageSquare size={12} strokeWidth={2} aria-hidden="true" />
                {p.commentCount}
              </>
            )}
          </span>
          <span className="fp-cell-meta fp-meta">{metaLine}</span>
        </button>
      )}
      <span className="fp-cell-actions fp-row-end">
        {!isEditing && (
          <>
            <button
              type="button"
              className="fp-rename-btn"
              aria-label={`Rename ${p.title}`}
              onClick={(e) => { e.stopPropagation(); onStartRename(); }}
              title="Rename"
            >
              <Pencil size={14} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="fp-trash-btn"
              aria-label={`Move ${p.title} to trash`}
              onClick={(e) => { e.stopPropagation(); onRequestDelete(); }}
              title="Move to trash"
            >
              <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
            </button>
            <RowKebab
              title={p.title}
              onRename={onStartRename}
              onRequestDelete={onRequestDelete}
            />
          </>
        )}
      </span>
    </div>
  );
}

function RowKebab({
  title, onRename, onRequestDelete,
}: {
  title: string;
  onRename(): void;
  onRequestDelete(): void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="fp-kebab-wrap" ref={wrapRef}>
      <button
        type="button"
        className="fp-kebab-btn"
        aria-label={`More actions for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        <MoreVertical size={18} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <div className="fp-kebab-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="fp-kebab-item"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onRename(); }}
          >
            <Pencil size={14} strokeWidth={2} aria-hidden="true" />
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className="fp-kebab-item fp-kebab-item-danger"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onRequestDelete(); }}
          >
            <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
            Move to trash
          </button>
        </div>
      )}
    </span>
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
