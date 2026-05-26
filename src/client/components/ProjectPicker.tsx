import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { PresenceAvatars } from './PresenceAvatars';
import { ChevronDown, ChevronUp, FolderOpen, HelpCircle, MessageSquare, MoreVertical, Pencil, Trash2, X } from 'lucide-react';
import type { Project, TrashList } from '../data/types';
import type { Song } from '../../shared/types';
import { AUDIO_EXT } from '../lib/audio';
import { colorForSong } from '../lib/colors';
import { formatDurationMs, formatPurgeIn, formatRelativeDate } from '../lib/format';

// Mirror of PURGE_AFTER_SECONDS in src/server/trash.ts. Duplicated rather than
// imported so the client bundle doesn't pull a server module.
const TRASH_TTL_DAYS = 30;
import { WaveformThumb } from './WaveformThumb';

type SortKey = 'name' | 'updated' | 'duration' | 'stems' | 'comments';
type SortDir = 'asc' | 'desc';

type Tab = 'recent' | 'all' | 'trash';

// How many "Filter by song" starter chips to show when the search box is
// empty — enough to advertise the feature, few enough to stay on one line
// even with a large catalog. Typing reveals the rest.
const STARTER_SONG_LIMIT = 6;

type Props = {
  open: boolean;
  loading: boolean;
  loadError: string | null;
  projects: Project[];
  activeProjectId: string | null;
  // Passed through to PresenceAvatars on each project row so the current
  // user's own avatar is filtered out — otherwise the row for the project
  // you're viewing duplicates your account avatar from the header.
  currentUserId?: string | null;
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

export function ProjectPicker({
  open, loading, loadError, projects, activeProjectId, currentUserId, showUpload,
  bandSongs, songUsage, filterSongId, onSetFilterSongId,
  onClose, onSelect, onLoadFolder, onRetry,
  onRenameProject, onDeleteProject,
  trash, trashError, onLoadTrash, onRestoreProject, onRestoreStem,
}: Props) {
  const [tab, setTab] = useState<Tab>('recent');
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const pickerRowsRef = useRef<Project[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset highlight when search or tab changes so stale positions don't persist.
  useEffect(() => { setHighlightedIndex(-1); }, [search, tab]);

  const query = search.trim().toLowerCase();

  // Songs whose name matches the current query. These are offered as "Filter
  // by song" chip suggestions below the search box — a suggestion to narrow,
  // distinct from the project rows. Picking one promotes it to the active
  // facet; it does not, by itself, fold song matches into the row list.
  const matchingSongs = useMemo<Song[]>(() => {
    if (!query) return [];
    return bandSongs.filter(
      (s) => s.use_count > 0 && s.name.toLowerCase().includes(query),
    );
  }, [bandSongs, query]);

  const activeSong = filterSongId
    ? bandSongs.find((s) => s.id === filterSongId) ?? null
    : null;

  // Chips shown in the filter bar. While typing: the songs that match. When
  // the box is empty: a short starter set of the most-used songs, so the
  // feature stays visible without dumping the whole catalog. The active song
  // is never offered as a chip — the pill already represents it.
  const songChips = useMemo<Song[]>(() => {
    const pool = query
      ? matchingSongs
      : [...bandSongs]
          .filter((s) => s.use_count > 0)
          .sort((a, b) => b.use_count - a.use_count || a.name.localeCompare(b.name))
          .slice(0, STARTER_SONG_LIMIT);
    return pool.filter((s) => s.id !== filterSongId);
  }, [query, matchingSongs, bandSongs, filterSongId]);

  const isFiltered = Boolean(query || filterSongId);
  const clearFilters = () => {
    setSearch('');
    onSetFilterSongId(null);
    searchInputRef.current?.focus();
  };

  // Orthogonal facets: the text query narrows project rows by title, the song
  // pill narrows by usage, and the two combine with AND. Songs are reached
  // through the chip facet, not by matching song names into the row list.
  const filteredProjects = useMemo<Project[]>(() => {
    let result = projects;
    if (filterSongId) {
      const allowed = new Set(
        songUsage
          .filter((u) => u.song_id === filterSongId)
          .map((u) => u.project_id),
      );
      result = result.filter((p) => allowed.has(p.id));
    }
    if (query) {
      result = result.filter((p) => p.title.toLowerCase().includes(query));
    }
    return result;
  }, [projects, songUsage, filterSongId, query]);

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

  // While the picker is open, mark everything outside the dialog as inert so
  // keyboard users and screen readers cannot drift into the page behind it.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const scrim = scrimRef.current;
    if (!dialog) return;
    const parent = dialog.parentElement;
    if (!parent) return;
    const toInert: Element[] = [];
    for (const child of Array.from(parent.children)) {
      if (child !== dialog && child !== scrim) toInert.push(child);
    }
    toInert.forEach(c => c.setAttribute('inert', ''));
    return () => toInert.forEach(c => c.removeAttribute('inert'));
  }, [open]);

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
        ref={scrimRef}
        className="projectpicker-scrim"
        data-testid="projectpicker-scrim"
        onClick={onClose}
        aria-hidden="true"
      />
      <div ref={dialogRef} className="projectpicker" role="dialog" aria-modal="true" aria-label="Projects">
        <div className="fp-header">
          <h2 className="fp-title">Projects</h2>
          <input
            ref={searchInputRef}
            autoFocus
            type="search"
            className="fp-search"
            placeholder="Search projects"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (tab === 'trash' || confirm) return;
              const count = pickerRowsRef.current.length;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightedIndex((i) => Math.min(i + 1, count - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightedIndex((i) => Math.max(i - 1, -1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const idx = highlightedIndex >= 0 ? highlightedIndex : (count === 1 ? 0 : -1);
                if (idx >= 0 && idx < count) {
                  onSelect(pickerRowsRef.current[idx].id);
                }
              }
            }}
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
        {tab !== 'trash' && (activeSong || songChips.length > 0) && (
          <div className="fp-song-bar" role="group" aria-label="Filter by song">
            {/* The eyebrow labels the suggestion chips; when only the active
                pill shows it's redundant (the pill is self-describing). */}
            {songChips.length > 0 && (
              <span className="fp-song-bar-label">Filter by song</span>
            )}
            {activeSong && (
              <button
                type="button"
                className="fp-song-active"
                data-testid={`fp-song-active-${activeSong.id}`}
                aria-label={`Clear song filter: ${activeSong.name}`}
                onClick={clearFilters}
              >
                <span
                  className="fp-song-chip-swatch"
                  style={{ background: colorForSong(activeSong.id) }}
                  aria-hidden="true"
                />
                <span>{activeSong.name}</span>
                <X size={12} strokeWidth={2.5} aria-hidden="true" />
              </button>
            )}
            {songChips.map((s) => (
              <button
                type="button"
                key={s.id}
                data-testid={`fp-song-chip-${s.id}`}
                className="fp-song-chip"
                aria-label={`Filter by song: ${s.name}`}
                onClick={() => {
                  onSetFilterSongId(s.id);
                  setSearch('');
                  // The clicked chip unmounts (it becomes the active pill), so
                  // return focus to the search box rather than losing it to body.
                  searchInputRef.current?.focus();
                }}
              >
                <span
                  className="fp-song-chip-swatch"
                  style={{ background: colorForSong(s.id) }}
                  aria-hidden="true"
                />
                <span>{s.name}</span>
                {s.use_count > 1 && (
                  <span className="fp-song-chip-count">{s.use_count}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {tab !== 'trash' && (
          <div className="sr-only" role="status" aria-live="polite">
            {isFiltered
              ? `${filteredProjects.length} ${filteredProjects.length === 1 ? 'project matches' : 'projects match'}`
              : ''}
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
          <ProjectPickerBody
            loading={loading} loadError={loadError}
            projects={filteredProjects} activeProjectId={activeProjectId}
            currentUserId={currentUserId}
            showUpload={showUpload}
            isFiltered={isFiltered}
            searchText={query}
            songSuggestionCount={query ? songChips.length : 0}
            onClearFilters={clearFilters}
            onSelect={onSelect}
            onNewProjectClick={() => folderInputRef.current?.click()}
            onRetry={onRetry}
            onRenameProject={onRenameProject}
            onRequestDelete={(id, name) => setConfirm({ id, name })}
            highlightedIndex={highlightedIndex}
            rowsRef={pickerRowsRef}
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

function ProjectPickerBody({
  projects, activeProjectId, currentUserId, loading, loadError, showUpload,
  isFiltered, searchText, songSuggestionCount, onClearFilters,
  onSelect, onNewProjectClick, onRetry, onRenameProject, onRequestDelete,
  highlightedIndex, rowsRef,
}: {
  loading: boolean;
  loadError: string | null;
  projects: Project[];
  activeProjectId: string | null;
  currentUserId: string | null | undefined;
  showUpload: boolean;
  isFiltered: boolean;
  searchText: string;
  songSuggestionCount: number;
  onClearFilters(): void;
  onSelect(id: string): void;
  onNewProjectClick(): void;
  onRetry(): void;
  onRenameProject(id: string, name: string): void;
  onRequestDelete(id: string, name: string): void;
  highlightedIndex: number;
  rowsRef: MutableRefObject<Project[]>;
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
    rowsRef.current = [];
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
    rowsRef.current = [];
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
            <span className="fp-cell-presence fp-skel fp-skel-meta" />
            <span className="fp-cell-actions" />
          </div>
        ))}
      </div>
    );
  }
  if (projects.length === 0) {
    rowsRef.current = [];
    // A filtered-to-empty list is a different situation from a truly empty
    // band — don't tell someone with projects to go create their first one.
    if (isFiltered) {
      // If the typed text matches no project title but DOES match a song,
      // point at the chips above (which preserve their intent) rather than
      // only offering to throw the query away.
      const pointToSongs = searchText.length > 0 && songSuggestionCount > 0;
      return (
        <div className="fp-body fp-state">
          <p className="fp-state-msg">
            {pointToSongs
              ? `No project titled “${searchText}”.`
              : 'No projects match your search.'}
          </p>
          {pointToSongs && (
            <p className="fp-state-secondary">
              Pick a song above to filter by it instead.
            </p>
          )}
          <button type="button" className="fp-state-action" onClick={onClearFilters}>
            Clear search
          </button>
        </div>
      );
    }
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

  const rows = sortProjects(projects, sort);
  // Keep the parent's ref in sync so Arrow/Enter handlers resolve the right project.
  rowsRef.current = rows;

  return (
    <div className="fp-body">
      <div className="fp-row fp-row-head" role="row">
        <SortHeader className="fp-cell-name" label="Name" sortKey="name" sort={sort} onClick={toggleSort} />
        <span className="fp-cell-thumb">Waveform</span>
        <SortHeader className="fp-cell-date" label="Updated" sortKey="updated" sort={sort} onClick={toggleSort} />
        <SortHeader className="fp-cell-duration" label="Length" sortKey="duration" sort={sort} onClick={toggleSort} />
        <SortHeader className="fp-cell-stems" label="Stems" sortKey="stems" sort={sort} onClick={toggleSort} />
        <SortHeader className="fp-cell-comments" label="Comments" sortKey="comments" sort={sort} onClick={toggleSort} />
        <span className="fp-cell-presence" />
        <span className="fp-cell-actions" />
      </div>
      {rows.map((p, i) => (
        <ProjectRow
          key={p.id}
          project={p}
          active={p.id === activeProjectId}
          highlighted={i === highlightedIndex}
          editing={editing?.id === p.id ? editing.draft : null}
          currentUserId={currentUserId}
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
  project: p, active, highlighted, editing, currentUserId,
  onSelect, onStartRename, onChangeDraft, onCommitRename, onCancelRename,
  onRequestDelete,
}: {
  project: Project;
  active: boolean;
  highlighted: boolean;
  editing: string | null;
  currentUserId: string | null | undefined;
  onSelect(): void;
  onStartRename(): void;
  onChangeDraft(draft: string): void;
  onCommitRename(): void;
  onCancelRename(): void;
  onRequestDelete(): void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const isEditing = editing !== null;

  useEffect(() => {
    if (highlighted && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [highlighted]);
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
      ref={rowRef}
      data-testid={`fp-row-${p.id}`}
      className={'fp-row fp-row-data' + (active ? ' active' : '') + (highlighted ? ' fp-row-highlighted' : '')}
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
          <span className="fp-cell-thumb"><WaveformThumb stemId={p.referenceStemId} peaks={p.referenceStemPeaks} /></span>
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
          <span className="fp-cell-thumb"><WaveformThumb stemId={p.referenceStemId} peaks={p.referenceStemPeaks} /></span>
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
      <span className="fp-cell-presence">
        <PresenceAvatars projectId={p.id} currentUserId={currentUserId} />
      </span>
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
      <TrashPolicyNote />
      <div className="fp-row fp-row-trash fp-row-head" role="row">
        <span>Name</span>
        <span>Type</span>
        <span>Deleted by</span>
        <span>Status</span>
        <span>Auto-clears</span>
        <span></span>
      </div>
      {trash.projects.map((p) => (
        <div key={`p-${p.id}`} className="fp-row fp-row-trash fp-row-data">
          <span className="fp-name">{p.name}</span>
          <span className="fp-meta">Project</span>
          <span className="fp-meta">{p.deleted_by_email ?? '—'}</span>
          <span className="fp-meta">
            {p.deleted_reason === 'drive_missing' ? 'File missing' : ''}
          </span>
          <TrashPurgeCell deletedAt={p.deleted_at} />
          <button
            type="button"
            className="fp-restore-btn"
            aria-label={`Restore ${p.name}`}
            disabled={p.deleted_reason === 'drive_missing'}
            onClick={() => onRestoreProject(p.id)}
          >
            Restore
          </button>
        </div>
      ))}
      {trash.stems.map((s) => (
        <div key={`s-${s.id}`} className="fp-row fp-row-trash fp-row-data">
          <span className="fp-name">{s.name}</span>
          <span className="fp-meta">Stem · {s.project_name}</span>
          <span className="fp-meta">{s.deleted_by_email ?? '—'}</span>
          <span className="fp-meta">
            {s.deleted_reason === 'drive_missing' ? 'File missing' : ''}
          </span>
          <TrashPurgeCell deletedAt={s.deleted_at} />
          <button
            type="button"
            className="fp-restore-btn"
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

function TrashPolicyNote() {
  const policy =
    `Items moved to trash are kept for ${TRASH_TTL_DAYS} days, then permanently deleted. ` +
    `Restore an item before then to recover it. Items marked "File missing" can't be restored.`;
  return (
    <div className="fp-trash-policy" role="note">
      <span>
        Items in trash auto-clear after {TRASH_TTL_DAYS} days.
      </span>
      <span
        className="fp-trash-policy-help"
        tabIndex={0}
        role="img"
        aria-label={policy}
        title={policy}
      >
        <HelpCircle size={14} strokeWidth={2} aria-hidden="true" />
      </span>
    </div>
  );
}

function TrashPurgeCell({ deletedAt }: { deletedAt: number }) {
  const { label, absolute } = formatPurgeIn(deletedAt, TRASH_TTL_DAYS);
  return (
    <span className="fp-meta" title={`Auto-clears on ${absolute}`}>
      {label}
    </span>
  );
}
