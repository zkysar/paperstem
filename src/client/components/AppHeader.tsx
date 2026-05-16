import { useEffect, useRef, useState } from 'react';
import { Bug, Check, ChevronDown, Download, FolderOpen, KeyRound, Loader2, LogIn, LogOut, MessageSquare, Plus, Settings, Users } from 'lucide-react';
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
  // Optional: when provided, the switcher menu grows a "+ New group" entry.
  onCreateGroup?: () => void;
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
  // Optional so callers in tests don't need to wire this; absent =
  // the menu entry is hidden (legacy callers behave as before).
  onOpenGroupSettings?: () => void;
  onDownloadAll(): void;
  /**
   * Public-link / read-only mode. When set, the header strips project-
   * picker affordances (no "Open a project" CTA, no switch-project caret,
   * title is shown but not interactive), hides the group switcher, and
   * replaces the authenticated avatar dropdown with a button that calls
   * onSignIn. The existing onOpenPicker/onSignOut/onReportBug/onOpenTokens
   * callbacks are not invoked while in this mode — callers can safely
   * pass no-ops.
   *
   * `label` lets the caller adjust the button copy — public-link views
   * use "Sign in" for anonymous viewers and "No access" for users who
   * are signed in but not a member of the project's band (where signing
   * in again would just loop them through the same state).
   */
  publicMode?: { onSignIn(): void; label?: string };
};

export function AppHeader({
  userEmail, userInitials, groups, currentGroupId, onSwitchGroup, onCreateGroup,
  projectTitle, stemCount, duration,
  annotationsOpen, hasProject, canRename, isWide, appVersion, appEnv, downloading,
  debugInfo,
  onOpenPicker, onToggleAnnotations, onSignOut, onReportBug, onRenameProject,
  onOpenTokens, onOpenGroupSettings, onDownloadAll, publicMode,
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
  // Group switcher is band-roster info — hide it in public mode so an
  // anonymous viewer can't see what other groups the link's owner is in.
  const showGroupSwitcher = !publicMode && groupList.length > 1;
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

  const titleEditable = !publicMode && hasProject && canRename && isWide;

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
                {onCreateGroup && (
                  <>
                    <div
                      className="ah-group-menu-divider"
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      role="menuitem"
                      className="ah-group-menu-create"
                      onClick={() => {
                        setGroupOpen(false);
                        onCreateGroup();
                      }}
                    >
                      <Plus size={14} strokeWidth={2} aria-hidden="true" />
                      <span className="ah-group-menu-name">New group</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <span className="ah-divider" />
        </>
      )}
      {hasProject ? (
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
            ) : publicMode ? (
              <span className="ah-title-name" title={projectTitle ?? undefined}>
                {projectTitle}
              </span>
            ) : (
              <button
                type="button"
                className={'ah-title-name' + (titleEditable ? ' ah-title-name-editable' : '')}
                onClick={() => {
                  if (titleEditable) {
                    setEditing(true);
                  } else {
                    onOpenPicker();
                  }
                }}
                title={titleEditable ? 'Click to rename' : 'Switch project'}
              >
                {projectTitle}
              </button>
            )}
            {!publicMode && (
              <button
                type="button"
                className="ah-title-caret"
                onClick={onOpenPicker}
                aria-label="Switch project"
                title="Switch to a different project"
              >
                <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </span>
        </div>
      ) : publicMode ? null : (
        <button
          type="button"
          className="ah-open-cta"
          onClick={onOpenPicker}
          title="Open a project"
        >
          <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
          Open a project
        </button>
      )}
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
      {publicMode ? (
        <button
          type="button"
          className="ah-signin-btn"
          onClick={publicMode.onSignIn}
          title={publicMode.label === 'No access'
            ? "You're signed in but not a member of this project's group"
            : 'Sign in to comment and edit'}
        >
          <LogIn size={14} strokeWidth={2} aria-hidden="true" />
          <span>{publicMode.label ?? 'Sign in'}</span>
        </button>
      ) : (
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
            {onOpenGroupSettings && currentGroup && (
              <button
                type="button"
                role="menuitem"
                onClick={() => { setAvatarOpen(false); onOpenGroupSettings(); }}
              >
                <Settings size={14} strokeWidth={2} aria-hidden="true" /> Group settings
              </button>
            )}
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
      )}
    </header>
  );
}
