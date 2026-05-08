import { useEffect, useRef, useState } from 'react';
import type { Practice } from '../data/types';
import { AUDIO_EXT } from '../lib/audio';

type Tab = 'recent' | 'all' | 'local';

type Props = {
  open: boolean;
  loading: boolean;
  loadError: string | null;
  practices: Practice[];
  activePracticeId: string | null;
  showUpload: boolean;
  onClose(): void;
  onSelect(id: string): void;
  onLoadFolder(files: File[], folderName: string): void;
  onUploadClick(): void;
  onRetry(): void;
};

export function FilePicker({
  open, loading, loadError, practices, activePracticeId, showUpload,
  onClose, onSelect, onLoadFolder, onUploadClick, onRetry,
}: Props) {
  const [tab, setTab] = useState<Tab>('recent');
  const [search, setSearch] = useState('');
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
      <div className="filepicker" role="dialog" aria-modal="true" aria-label="Practices">
        <div className="fp-header">
          <h2 className="fp-title">Practices</h2>
          <input
            type="search"
            className="fp-search"
            placeholder="Search practices"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {showUpload && (
            <button type="button" className="fp-upload-btn" onClick={onUploadClick}>
              + Upload
            </button>
          )}
          <button
            type="button"
            className="fp-close"
            onClick={onClose}
            aria-label="Close picker"
          >
            ✕
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
            aria-selected={tab === 'local'}
            className={'fp-tab' + (tab === 'local' ? ' active' : '')}
            onClick={() => {
              setTab('local');
              folderInputRef.current?.click();
            }}
          >Local folder…</button>
        </div>
        <input
          ref={folderInputRef}
          type="file"
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          multiple hidden onChange={onFolderPicked}
        />
        <FilePickerBody
          tab={tab} search={search}
          loading={loading} loadError={loadError}
          practices={practices} activePracticeId={activePracticeId}
          showUpload={showUpload}
          onSelect={onSelect}
          onUploadClick={onUploadClick}
          onRetry={onRetry}
        />
      </div>
    </>
  );
}

function FilePickerBody({
  search, practices, activePracticeId, loading, loadError, showUpload,
  onSelect, onUploadClick, onRetry,
}: {
  tab: Tab;
  search: string;
  loading: boolean;
  loadError: string | null;
  practices: Practice[];
  activePracticeId: string | null;
  showUpload: boolean;
  onSelect(id: string): void;
  onUploadClick(): void;
  onRetry(): void;
}) {
  if (loadError) {
    return (
      <div className="fp-body fp-state">
        <p className="fp-state-msg">Couldn't load practices ({loadError}).</p>
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
  if (practices.length === 0) {
    return (
      <div className="fp-body fp-state">
        <p className="fp-state-msg">No practices yet.</p>
        {showUpload && (
          <button type="button" className="fp-state-action" onClick={onUploadClick}>
            + Upload practice
          </button>
        )}
        <p className="fp-state-secondary">
          Or use the “Local folder…” tab to play stems off your disk.
        </p>
      </div>
    );
  }

  const filtered = practices.filter((p) => {
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
      {rows.map((p) => (
        <div
          key={p.id}
          data-testid={`fp-row-${p.id}`}
          className={'fp-row fp-row-data' + (p.id === activePracticeId ? ' active' : '')}
        >
          <button
            type="button"
            className="fp-row-main"
            onClick={() => onSelect(p.id)}
          >
            <span className="fp-name">{p.title}</span>
            <span className="fp-thumb" aria-hidden="true" />
            <span className="fp-meta">{p.folder ?? ''}</span>
            <span className="fp-meta">{p.stems.length}</span>
          </button>
          <span className="fp-row-end">
            {p.driveFolderId && (
              <a
                className="fp-drive-link"
                href={`https://drive.google.com/drive/folders/${encodeURIComponent(p.driveFolderId)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="Open in Drive"
              >
                ↗
              </a>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
