import { useRef } from 'react';
import type { Practice } from '../data/types';
import { AUDIO_EXT } from '../lib/audio';

type Props = {
  practices: Practice[];
  activePracticeId: string | null;
  loadError: string | null;
  drawerOpen: boolean;
  onClose(): void;
  onSelect(id: string): void;
  onLoadFolder(files: File[], folderName: string): void;
};

export function Sidebar({
  practices,
  activePracticeId,
  loadError,
  drawerOpen,
  onClose,
  onSelect,
  onLoadFolder,
}: Props) {
  const folderInputRef = useRef<HTMLInputElement>(null);

  function handleFolderPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const all = Array.from(e.target.files ?? []);
    const audio = all.filter((f) => AUDIO_EXT.test(f.name));
    audio.sort((a, b) => a.name.localeCompare(b.name));
    if (!audio.length) {
      onLoadFolder([], '');
      return;
    }
    const rel = audio[0].webkitRelativePath || audio[0].name;
    const folderName = rel.split('/')[0] || 'Local folder';
    onLoadFolder(audio, folderName);
    if (folderInputRef.current) folderInputRef.current.value = '';
  }

  return (
    <aside className={'sidebar' + (drawerOpen ? ' open' : '')}>
      <button
        type="button"
        className="sidebar-close"
        aria-label="Close practices menu"
        onClick={onClose}
      >
        ✕
      </button>
      <h1 className="brand">Paperstem</h1>
      <div className="brand-tag">Practices</div>
      {loadError ? (
        <div className="empty" style={{ fontSize: '0.78rem' }}>
          Could not load practices.json ({loadError}). Use “Load local folder…” to load stems manually.
        </div>
      ) : (
        <ul className="practice-list">
          {practices.length === 0 && (
            <li className="empty" style={{ fontSize: '0.78rem' }}>
              No practices yet.
            </li>
          )}
          {practices.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={'practice-item' + (p.id === activePracticeId ? ' active' : '')}
                onClick={() => onSelect(p.id)}
              >
                <span className="practice-title">{p.title}</span>
                <span className="practice-meta">
                  {p.folder.replace(/\/$/, '')} · {p.stems.length} stems
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="sidebar-footer">
        <input
          ref={folderInputRef}
          type="file"
          // Non-standard but widely supported. TS needs the cast.
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          multiple
          hidden
          onChange={handleFolderPicked}
        />
        <button type="button" onClick={() => folderInputRef.current?.click()}>
          Load local folder…
        </button>
      </div>
    </aside>
  );
}
