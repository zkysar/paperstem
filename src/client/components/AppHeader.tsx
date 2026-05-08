import { useEffect, useRef, useState } from 'react';
import { fmt } from '../lib/format';

type Props = {
  userEmail: string;
  userInitials: string;
  practiceTitle: string | null;
  stemCount: number;
  duration: number;
  driveFolderId: string | null;
  annotationsOpen: boolean;
  hasPractice: boolean;
  onOpenPicker(): void;
  onToggleAnnotations(): void;
  onSignOut(): void;
};

export function AppHeader({
  userEmail, userInitials, practiceTitle, stemCount, duration,
  driveFolderId, annotationsOpen, hasPractice,
  onOpenPicker, onToggleAnnotations, onSignOut,
}: Props) {
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!avatarOpen) return;
    function onDoc(e: MouseEvent) {
      if (!avatarRef.current?.contains(e.target as Node)) setAvatarOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [avatarOpen]);

  return (
    <header className="app-header">
      <button
        type="button"
        className="ah-files"
        onClick={onOpenPicker}
        title="Open practices (⌘K)"
        aria-label="Open practices"
      >
        ▦
      </button>
      <h1 className="ah-brand">Paperstem</h1>
      <span className="ah-divider" />
      <div className="ah-title-block">
        <span className="ah-title-label">Practice</span>
        <span className="ah-title-row">
          <span className="ah-title-name">
            {practiceTitle ?? 'No practice'}
          </span>
          <button
            type="button"
            className="ah-title-caret"
            onClick={onOpenPicker}
            aria-label="Switch practice"
          >
            ▾
          </button>
        </span>
      </div>
      <span className="ah-spacer" />
      {hasPractice && (
        <span className="ah-meta">
          {stemCount} stems · {fmt(duration)}
        </span>
      )}
      {driveFolderId && (
        <a
          className="ah-iconbtn"
          href={`https://drive.google.com/drive/folders/${encodeURIComponent(driveFolderId)}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in Drive"
        >
          ↗
        </a>
      )}
      {hasPractice && (
        <button
          type="button"
          className={'ah-iconbtn' + (annotationsOpen ? ' active' : '')}
          onClick={onToggleAnnotations}
          aria-pressed={annotationsOpen}
          title="Comments"
        >
          💬
        </button>
      )}
      <div className="ah-avatar-wrap" ref={avatarRef}>
        <button
          type="button"
          className="ah-avatar"
          onClick={() => setAvatarOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={avatarOpen}
          aria-label="Account"
        >
          {userInitials}
        </button>
        {avatarOpen && (
          <div className="ah-avatar-menu" role="menu">
            <div className="ah-avatar-email">{userEmail}</div>
            <button type="button" role="menuitem" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
