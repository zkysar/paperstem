import { useEffect, useRef, useState } from 'react';
import { PresenceAvatars } from './PresenceAvatars';
import { Bug, Check, ChevronDown, Download, FolderOpen, KeyRound, Loader2, LogIn, LogOut, MessageSquare, Plus, Users } from 'lucide-react';
import { fmt } from '../lib/format';
import { githubUrlForVersion } from '../../shared/version';
import type { BandWithRole } from '../../shared/types';

type Props = {
  userEmail: string;
  userInitials: string;
  // The user's groups (a.k.a. bands at the DB layer). The switcher renders
  // whenever the user is in 1+ groups so the "+ New group" entry has a
  // stable home; with zero groups the switcher is hidden and the empty
  // state inside the main panel carries the create-group affordance.
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
  onOpenGroups?: () => void;
  onDownloadAll(): void;
  currentProjectId: string | null;
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
  onOpenTokens, onOpenGroups, onDownloadAll, currentProjectId, publicMode,
}: Props) {
  const envBadge = appEnv && appEnv !== 'prod' ? appEnv.toUpperCase() : null;
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);

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
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setAvatarOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [avatarOpen]);

  const groupList = groups ?? [];
  // Show the switcher whenever it would be useful. With 2+ groups that's
  // always; with exactly 1 group, only if the menu can offer "+ New group"
  // (otherwise the menu would be a single inert row). Hidden in public mode
  // so anonymous viewers can't enumerate the link owner's band membership.
  const showGroupSwitcher =
    !publicMode &&
    (groupList.length > 1 || (groupList.length === 1 && !!onCreateGroup));
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
        className="ah-iconbtn ah-hide-on-mobile"
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
      {hasProject && currentProjectId && !publicMode ? (
        <PresenceAvatars projectId={currentProjectId} />
      ) : null}
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
          className={'ah-avatar' + (downloading ? ' ah-avatar-busy' : '')}
          onClick={() => setAvatarOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={avatarOpen}
          aria-label="Account"
          title={downloading
            ? `Account (${userEmail}) — downloading stems…`
            : `Account (${userEmail})`}
        >
          {userInitials}
        </button>
        {avatarOpen && (
          <div className="ah-avatar-menu" role="menu">
            <div className="ah-avatar-email">{userEmail}</div>
            {showGroupSwitcher && currentGroup && (
              <>
                <div className="ah-avatar-menu-label" aria-hidden="true">Switch group</div>
                {groupList.map((g) => {
                  const active = g.id === currentGroup.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      role="menuitem"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => {
                        setAvatarOpen(false);
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
                  <button
                    type="button"
                    role="menuitem"
                    className="ah-group-menu-create"
                    onClick={() => {
                      setAvatarOpen(false);
                      onCreateGroup();
                    }}
                  >
                    <Plus size={14} strokeWidth={2} aria-hidden="true" />
                    <span className="ah-group-menu-name">New group</span>
                  </button>
                )}
                <div className="ah-avatar-menu-divider" role="separator" />
              </>
            )}
            {!isWide && hasProject && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  aria-pressed={annotationsOpen}
                  onClick={() => { setAvatarOpen(false); onToggleAnnotations(); }}
                >
                  <MessageSquare size={14} strokeWidth={2} aria-hidden="true" />
                  {annotationsOpen ? 'Close comments' : 'Open comments'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={downloading}
                  onClick={() => {
                    if (downloading) return;
                    setAvatarOpen(false);
                    onDownloadAll();
                  }}
                >
                  {downloading
                    ? <Loader2 size={14} strokeWidth={2} className="atb-spin" aria-hidden="true" />
                    : <Download size={14} strokeWidth={2} aria-hidden="true" />}
                  {downloading ? 'Downloading…' : 'Download all stems'}
                </button>
                <div className="ah-avatar-menu-divider" role="separator" />
              </>
            )}
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
            {onOpenGroups && (
              <button
                type="button"
                role="menuitem"
                onClick={() => { setAvatarOpen(false); onOpenGroups(); }}
              >
                <Users size={14} strokeWidth={2} aria-hidden="true" /> Groups
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
