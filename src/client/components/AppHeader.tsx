import { useEffect, useRef, useState } from 'react';
import { Bug, ChevronDown, ExternalLink, Library, MessageSquare } from 'lucide-react';
import { fmt } from '../lib/format';
import { githubUrlForVersion } from '../../shared/version';

type Props = {
  userEmail: string;
  userInitials: string;
  practiceTitle: string | null;
  stemCount: number;
  duration: number;
  driveFolderId: string | null;
  annotationsOpen: boolean;
  hasPractice: boolean;
  canRename: boolean;
  appVersion: string | null;
  appEnv: string | null;
  onOpenPicker(): void;
  onToggleAnnotations(): void;
  onSignOut(): void;
  onReportBug(): void;
  onRenamePractice(name: string): void;
};

export function AppHeader({
  userEmail, userInitials, practiceTitle, stemCount, duration,
  driveFolderId, annotationsOpen, hasPractice, canRename, appVersion, appEnv,
  onOpenPicker, onToggleAnnotations, onSignOut, onReportBug, onRenamePractice,
}: Props) {
  const envBadge = appEnv && appEnv !== 'prod' ? appEnv.toUpperCase() : null;
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(practiceTitle ?? '');

  useEffect(() => {
    setDraft(practiceTitle ?? '');
  }, [practiceTitle]);

  useEffect(() => {
    if (!avatarOpen) return;
    function onDoc(e: MouseEvent) {
      if (!avatarRef.current?.contains(e.target as Node)) setAvatarOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [avatarOpen]);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === practiceTitle) return;
    onRenamePractice(next);
  }

  function cancel() {
    setEditing(false);
    setDraft(practiceTitle ?? '');
  }

  const titleEditable = hasPractice && canRename;

  return (
    <header className="app-header">
      <button
        type="button"
        className="ah-files"
        onClick={onOpenPicker}
        title="Open practices (⌘K)"
        aria-label="Open practices"
      >
        <Library size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      <h1 className="ah-brand">Paperstem</h1>
      {envBadge && (
        <span
          className={`ah-env-badge ah-env-${appEnv}`}
          title={`Environment: ${appEnv}`}
          aria-label={`Environment: ${appEnv}`}
        >
          {envBadge}
        </span>
      )}
      <span className="ah-divider" />
      <div className="ah-title-block">
        <span className="ah-title-label">Practice</span>
        <span className="ah-title-row">
          {editing && titleEditable ? (
            <input
              className="ah-title-input"
              aria-label="Rename practice"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancel();
                }
              }}
              onBlur={commit}
            />
          ) : (
            <button
              type="button"
              className={'ah-title-name' + (titleEditable ? ' ah-title-name-editable' : '')}
              onClick={() => { if (titleEditable) setEditing(true); }}
              disabled={!titleEditable}
              title={titleEditable ? 'Click to rename' : undefined}
            >
              {practiceTitle ?? 'No practice'}
            </button>
          )}
          <button
            type="button"
            className="ah-title-caret"
            onClick={onOpenPicker}
            aria-label="Switch practice"
          >
            <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
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
          aria-label="Open in Drive"
        >
          <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />
        </a>
      )}
      {hasPractice && (
        <button
          type="button"
          className={'ah-iconbtn' + (annotationsOpen ? ' active' : '')}
          onClick={onToggleAnnotations}
          aria-pressed={annotationsOpen}
          title="Comments"
          aria-label="Toggle comments"
        >
          <MessageSquare size={16} strokeWidth={2} aria-hidden="true" />
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
            <button
              type="button"
              role="menuitem"
              onClick={() => { setAvatarOpen(false); onReportBug(); }}
            >
              <Bug size={14} strokeWidth={2} aria-hidden="true" /> Report a bug
            </button>
            <button type="button" role="menuitem" onClick={onSignOut}>
              Sign out
            </button>
            {appVersion && (
              <a
                className="ah-avatar-version"
                href={githubUrlForVersion(appVersion)}
                target="_blank"
                rel="noopener noreferrer"
                title="View this build on GitHub"
              >
                {appVersion}
              </a>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
