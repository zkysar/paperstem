import { useRef } from 'react';
import type { Project } from '../data/types';
import { AUDIO_EXT } from '../lib/audio';

type Props = {
  projects: Project[];
  activeProjectId: string | null;
  loadError: string | null;
  drawerOpen: boolean;
  userEmail: string;
  showUpload: boolean;
  onClose(): void;
  onSelect(id: string): void;
  onLoadFolder(files: File[], folderName: string): void;
  onUploadClick(): void;
  onLogout(): void;
};

export function Sidebar({
  projects,
  activeProjectId,
  loadError,
  drawerOpen,
  userEmail,
  showUpload,
  onClose,
  onSelect,
  onLoadFolder,
  onUploadClick,
  onLogout,
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
        aria-label="Close projects menu"
        onClick={onClose}
      >
        ✕
      </button>
      <h1 className="brand">Paperstem</h1>
      <div className="brand-tag">Projects</div>
      {loadError ? (
        <div className="empty" style={{ fontSize: '0.78rem' }}>
          Could not load projects.json ({loadError}). Use “Load local folder…” to load stems manually.
        </div>
      ) : (
        <ul className="project-list">
          {projects.length === 0 && (
            <li className="empty" style={{ fontSize: '0.78rem' }}>
              No projects yet.
            </li>
          )}
          {projects.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={'project-item' + (p.id === activeProjectId ? ' active' : '')}
                onClick={() => onSelect(p.id)}
              >
                <span className="project-title">{p.title}</span>
                {(p.folder || p.stems.length > 0) && (
                  <span className="project-meta">
                    {p.folder
                      ? `${p.folder.replace(/\/$/, '')} · ${p.stems.length} stems`
                      : `${p.stems.length} stems`}
                  </span>
                )}
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
        {showUpload && (
          <button type="button" onClick={onUploadClick}>
            Upload project…
          </button>
        )}
        <div className="sidebar-user">
          <span className="sidebar-user-email">{userEmail}</span>
          <button type="button" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
