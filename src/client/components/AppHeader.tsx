import { useEffect, useRef, useState } from 'react';
import { Bug, Check, ChevronDown, Download, KeyRound, Loader2, LogOut, MessageSquare, Users } from 'lucide-react';
import { fmt } from '../lib/format';
import { githubUrlForVersion } from '../../shared/version';
import type { BandWithRole } from '../../shared/types';

type Props = {
  userEmail: string;
  userInitials: string;
  // The user's groups (a.k.a. bands at the DB layer). The switcher only
  // renders when there are 2+ groups; with one or zero the UI stays the same
  // as before this feature landed.
  groups?: BandWithRole[];
  currentGroupId?: string | null;
  onSwitchGroup?: (id: string) => void;
  projectTitle: string | null;
  stemCount: number;
  duration: number;
  annotationsOpen: boolean;
  hasProject: boolean;
  canRename: boolean;
  isWide: boolean;
  appVersion: string | null;
  appEnv: string | null;
  downloading: boolean;
  debugInfo: string;
  onOpenPicker(): void;
  onToggleAnnotations(): void;
  onSignOut(): void;
  onReportBug(): void;
  onRenameProject(name: string): void;
  onOpenTokens(): void;
  onDownloadAll(): void;
};

export function AppHeader({
  userEmail, userInitials, groups, currentGroupId, onSwitchGroup,
  projectTitle, stemCount, duration,
  annotationsOpen, hasProject, canRename, isWide, appVersion, appEnv, downloading,
  debugInfo,
  onOpenPicker, onToggleAnnotations, onSignOut, onReportBug, onRenameProject,
  onOpenTokens, onDownloadAll,
}: Props) {
  const envBadge = appEnv && appEnv !== 'prod' ? appEnv.toUpperCase() : null;
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(projectTitle ?? '');

  useEffect(() => {
    setDraft(projectTitle ?? '');
  }, [projectTitle]);

  useEffect(() => {
    if (!avatarOpen) return;
    function onDoc(e: MouseEvent) {
      if (!avatarRef.current?.contains(e.target as Node)) setAvatarOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [avatarOpen]);

  useEffect(() => {
    if (!groupOpen) return;
    function onDoc(e: MouseEvent) {
      if (!groupRef.current?.contains(e.target as Node)) setGroupOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setGroupOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [groupOpen]);

  const groupList = groups ?? [];
  const showGroupSwitcher = groupList.length > 1;
  const currentGroup =
    groupList.find((g) => g.id === currentGroupId) ?? groupList[0] ?? null;

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === projectTitle) return;
    onRenameProject(next);
  }

  function cancel() {
    setEditing(false);
    setDraft(projectTitle ?? '');
  }

  const titleEditable = hasProject && canRename && isWide;

  return (
    <header className="app-header">
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
      {showGroupSwitcher && currentGroup && (
        <>
          <div className="ah-group-block ah-group-wrap" ref={groupRef}>
            <span className="ah-group-label">Group</span>
            <button
              type="button"
              className="ah-group-trigger"
              onClick={() => setGroupOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={groupOpen}
              aria-label="Switch group"
              title={`Group: ${currentGroup.name} — click to switch`}
            >
              <Users size={14} strokeWidth={2} aria-hidden="true" />
              <span className="ah-group-name">{currentGroup.name}</span>
              <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
            </button>
            {groupOpen && (
              <div className="ah-group-menu" role="menu">
                {groupList.map((g) => {
                  const active = g.id === currentGroup.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      role="menuitem"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => {
                        setGroupOpen(false);
                        if (!active) onSwitchGroup?.(g.id);
                      }}
                    >
                      {active
                        ? <Check size={14} strokeWidth={2} aria-hidden="true" />
                        : <span className="ah-group-menu-spacer" aria-hidden="true" />}
                      <span className="ah-group-menu-name">{g.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <span className="ah-divider" />
        </>
      )}
      <div className="ah-title-block">
        <span className="ah-title-label">Project</span>
        <span className="ah-title-row">
          {editing && titleEditable ? (
            <input
              className="ah-title-input"
              aria-label="Rename project"
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
              onClick={() => {
                if (titleEditable) {
                  setEditing(true);
                } else if (hasProject) {
                  onOpenPicker();
                }
              }}
              disabled={!hasProject}
              title={titleEditable ? 'Click to rename' : 'Switch project'}
            >
              {projectTitle ?? 'No project'}
            </button>
          )}
          <button
            type="button"
            className="ah-title-caret"
            onClick={onOpenPicker}
            aria-label="Switch project"
            title="Switch to a different project"
          >
            <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </span>
      </div>
      <span className="ah-spacer" />
      {hasProject && (
        <span className="ah-meta">
          {stemCount} stems · {fmt(duration)}
        </span>
      )}
      <button
        type="button"
        className="ah-iconbtn"
        aria-label="Download all stems"
        disabled={!hasProject || downloading}
        onClick={onDownloadAll}
        title="Download all stems"
      >
        {downloading
          ? <Loader2 size={16} strokeWidth={2} className="atb-spin" aria-hidden="true" />
          : <Download size={16} strokeWidth={2} aria-hidden="true" />}
      </button>
      {hasProject && (
        <button
          type="button"
          className={'ah-iconbtn ah-hide-on-mobile' + (annotationsOpen ? ' active' : '')}
          onClick={onToggleAnnotations}
          aria-pressed={annotationsOpen}
          title={annotationsOpen ? 'Close the comments panel' : 'Open the comments panel — notes left on the timeline by you and other group members'}
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
          title={`Account (${userEmail})`}
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
            <button
              type="button"
              role="menuitem"
              onClick={() => { setAvatarOpen(false); onOpenTokens(); }}
            >
              <KeyRound size={14} strokeWidth={2} aria-hidden="true" /> Import tokens
            </button>
            <button type="button" role="menuitem" onClick={onSignOut}>
              <LogOut size={14} strokeWidth={2} aria-hidden="true" /> Sign out
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
            {debugInfo && (import.meta.env.DEV || appEnv === 'dev') && (
              <div className="ah-avatar-debug">{debugInfo}</div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
