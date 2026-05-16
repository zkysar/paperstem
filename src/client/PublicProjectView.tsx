import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  Annotation,
  AnnotationReply,
  ReactionTarget,
  Section,
} from '../shared/types';
import { AppHeader } from './components/AppHeader';
import { AppToolbar } from './components/AppToolbar';
import { CommentBottomSheet } from './components/CommentBottomSheet';
import { CommentPopover } from './components/CommentPopover';
import { CommentsDrawer, type DraftSpec } from './components/CommentsDrawer';
import { CommentsFab } from './components/CommentsFab';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Player } from './components/Player';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import {
  fetchPublicAnnotations,
  fetchPublicProject,
  fetchPublicReplies,
  fetchPublicSections,
  publicAudioUrl,
  type PublicAnnotation,
  type PublicProjectDetail,
  type PublicReply,
  type PublicSection,
} from './data/public-repo';
import type { StemSource } from './data/types';
import { useAppVersion } from './hooks/useAppVersion';
import { useIsMobile } from './hooks/useIsMobile';
import { useKeyboard } from './hooks/useKeyboard';
import { usePlayer } from './hooks/usePlayer';
import { useViewport } from './hooks/useViewport';
import { buildUserColorMap, SELF_ANNOTATION_COLOR } from './lib/colors';
import { downloadStemsAsZip } from './lib/download';
import { decodePeaks } from './lib/peaks';
import { PUBLIC_RETURN_PATH_KEY } from './lib/public-return';

// The /p/<token> page reuses the same AppHeader / AppToolbar / Player /
// CommentsDrawer / CommentsFab tree as the authenticated app. Every
// mutation handler in this file routes through promptSignIn(), which
// stashes the current path and bounces to /. Authenticated users land
// back on /p/<token> after the magic-link round trip; if they're also a
// member of the project's band the loader redirects them straight to
// /#p=<project_id>.

type FetchState =
  | { kind: 'loading' }
  | { kind: 'error'; status: number; message: string }
  | { kind: 'ready'; detail: PublicProjectDetail };

// PUBLIC_RETURN_PATH_KEY lives in ./lib/public-return so App.tsx can
// import it without pulling the whole public-view bundle.

function readTokenFromPath(): string | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/^\/p\/([A-Za-z0-9_-]+)\/?$/);
  return match ? match[1] : null;
}

// Public annotations don't carry user_id (we strip it server-side to
// avoid leaking the band roster), but the existing color map keys on it,
// and AnnotationMarkers expects an Annotation shape. Synthesise a stable
// pseudo-id from the display name so the color map gives same-author
// comments the same colour. Two authors with identical display names
// will collide — acceptable for an external viewer.
function pseudoUserId(name: string | null): string {
  const base = name ?? 'anonymous';
  let h = 0;
  for (let i = 0; i < base.length; i++) {
    h = (h * 31 + base.charCodeAt(i)) | 0;
  }
  return `public:${h}`;
}

function toAnnotation(a: PublicAnnotation): Annotation {
  const userId = pseudoUserId(a.user_display_name);
  return {
    id: a.id,
    project_id: a.project_id,
    user_id: userId,
    user_email: '',
    user_display_name: a.user_display_name,
    start_ms: a.start_ms,
    end_ms: a.end_ms,
    body: a.body,
    starred: a.starred,
    created_at: a.created_at,
    updated_at: a.updated_at,
    reply_count: a.reply_count,
    reactions: a.reactions.map((r) => ({
      emoji: r.emoji,
      count: r.count,
      user_ids: [],
      reacted_by_self: false,
    })),
  };
}

function toReply(r: PublicReply): AnnotationReply {
  return {
    id: r.id,
    annotation_id: r.annotation_id,
    user_id: pseudoUserId(r.user_display_name),
    user_email: '',
    user_display_name: r.user_display_name,
    body: r.body,
    created_at: r.created_at,
    updated_at: r.updated_at,
    reactions: r.reactions.map((rr) => ({
      emoji: rr.emoji,
      count: rr.count,
      user_ids: [],
      reacted_by_self: false,
    })),
  };
}

function toSection(s: PublicSection): Section {
  return {
    id: s.id,
    project_id: s.project_id,
    start_ms: s.start_ms,
    song_id: null,
    song_name: s.song_name,
    label: s.label,
    source: s.source,
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
}

export function PublicProjectView({ token }: { token: string }) {
  const player = usePlayer();
  const viewport = useViewport();
  const appInfo = useAppVersion();
  const isMobile = useIsMobile();

  // Ref so the loader effect can call player.load without re-firing on
  // every render (usePlayer returns a fresh control object each render).
  const playerRef = useRef(player);
  playerRef.current = player;

  const [state, setState] = useState<FetchState>({ kind: 'loading' });
  const [annotations, setAnnotations] = useState<PublicAnnotation[]>([]);
  const [sections, setSections] = useState<PublicSection[]>([]);
  const [replies, setReplies] = useState<Map<string, AnnotationReply[]>>(
    () => new Map(),
  );

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<
    { left: number; top: number } | null
  >(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(
    null,
  );
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [signInBanner, setSignInBanner] = useState(false);

  // Anonymous viewers can still want to land back here after sign-in.
  // We stash the path then send them to /. App.tsx reads this key after
  // the session is established and replaces location.
  const promptSignIn = useCallback(() => {
    try {
      sessionStorage.setItem(PUBLIC_RETURN_PATH_KEY, window.location.pathname);
    } catch {
      // sessionStorage can throw in some private-mode browsers; best-effort.
    }
    // Show a one-tick banner first so the user understands why they're
    // being moved. The setTimeout lets the banner paint before navigation.
    setSignInBanner(true);
    window.setTimeout(() => {
      window.location.assign('/');
    }, 250);
  }, []);

  // Track band membership for the link's project. If the visitor is
  // already signed in AND a member, redirect them to the authenticated
  // app — same project, but with full edit rights and no /p/<token>
  // chrome.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetch('/api/me', { credentials: 'include' });
        if (cancelled) return;
        if (!me.ok) return;
        const body = (await me.json()) as { user?: { id: string } | null };
        if (!body.user) return;
        // Logged in. See if the public response carries a project_id we
        // can dereference via the authenticated endpoint (200 ⇒ member).
        // We do this AFTER state.kind === 'ready' below.
      } catch {
        /* ignore — anonymous fallback is fine */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Bootstrap fetch: project + annotations + sections in parallel. Once
  // project metadata is in, try to resolve a member redirect.
  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      try {
        const detail = await fetchPublicProject(token);
        if (cancelled) return;

        // Membership-redirect probe: if signed-in AND a band member of
        // this project's band, hand off to the authenticated app. The
        // public endpoint won't accept the session, but /api/projects/:id
        // will return 200 only for members.
        try {
          const me = await fetch('/api/me', { credentials: 'include' });
          if (me.ok) {
            const meBody = (await me.json()) as { user?: { id: string } | null };
            if (meBody.user) {
              const authed = await fetch(
                `/api/projects/${encodeURIComponent(detail.project.id)}`,
                { credentials: 'include' },
              );
              if (authed.ok) {
                window.location.assign(
                  `/#p=${encodeURIComponent(detail.project.id)}`,
                );
                return;
              }
            }
          }
        } catch {
          /* anonymous fallback */
        }

        setState({ kind: 'ready', detail });
        const sources: StemSource[] = detail.stems.map((s) => ({
          name: s.name,
          src: publicAudioUrl(token, s.id),
          serverId: s.id,
          peaks: s.peaks ? decodePeaks(s.peaks) : null,
        }));
        void playerRef.current.load({
          projectId: detail.project.id,
          title: detail.project.name,
          folderId: null,
          sources,
        });
        try {
          const [anns, secs] = await Promise.all([
            fetchPublicAnnotations(token),
            fetchPublicSections(token),
          ]);
          if (cancelled) return;
          setAnnotations(anns);
          setSections(secs);
        } catch (err) {
          console.error('public secondary fetch failed', err);
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        const isGone = /HTTP 410|drive_missing/.test(msg);
        setState({ kind: 'error', status: isGone ? 410 : 404, message: msg });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const annotationsForPlayer = useMemo(
    () => annotations.map(toAnnotation),
    [annotations],
  );
  const sectionsForPlayer = useMemo(
    () => sections.map(toSection),
    [sections],
  );
  const userColorMap = useMemo(
    () => buildUserColorMap(annotationsForPlayer.map((a) => a.user_id), ''),
    [annotationsForPlayer],
  );

  // Drawer / popover handlers (these don't mutate the server — they're
  // just UI navigation, and behave identically to the authenticated app).
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleDrawer = useCallback(() => {
    setActiveCommentId(null);
    setPopoverAnchor(null);
    setDrawerOpen((v) => !v);
  }, []);
  const closePopovers = useCallback(() => {
    setActiveCommentId(null);
    setPopoverAnchor(null);
  }, []);

  const handleAnnotationSelected = useCallback(
    (a: Annotation) => {
      player.seek(a.start_ms / 1000);
      setActiveCommentId(a.id);
      queueMicrotask(() => {
        const el = document.querySelector(
          `[data-annotation-id="${a.id}"]`,
        ) as HTMLElement | null;
        if (!el) {
          setPopoverAnchor(null);
          return;
        }
        const r = el.getBoundingClientRect();
        setPopoverAnchor({ left: r.left + r.width / 2, top: r.top });
      });
      if (a.reply_count > 0 && !replies.has(a.id)) {
        void (async () => {
          try {
            const fetched = await fetchPublicReplies(token, a.id);
            setReplies((m) => {
              const next = new Map(m);
              next.set(a.id, fetched.map(toReply));
              return next;
            });
          } catch (err) {
            console.error('public reply fetch failed', err);
          }
        })();
      }
    },
    [player, replies, token],
  );

  const handleLoopAnnotation = useCallback(
    (a: Annotation) => {
      if (a.end_ms === null) return;
      player.setLoop(a.start_ms / 1000, a.end_ms / 1000);
      player.setLoopEnabled(true);
      player.seek(a.start_ms / 1000);
    },
    [player],
  );

  const handleSectionSelected = useCallback(
    (s: Section) => {
      player.seek(s.start_ms / 1000);
    },
    [player],
  );

  // Non-mutating: just load replies for display when the comment is
  // expanded. Public read endpoint, no auth needed.
  const loadReplies = useCallback(
    async (annotationId: string) => {
      if (replies.has(annotationId)) return;
      const fetched = await fetchPublicReplies(token, annotationId);
      setReplies((m) => {
        const next = new Map(m);
        next.set(annotationId, fetched.map(toReply));
        return next;
      });
    },
    [replies, token],
  );

  // Mutation routes — all bounce to sign-in. We declare them as
  // matching the component prop signatures so TypeScript checks the
  // wiring. Each invocation just calls promptSignIn().
  const promptIgnoreArgs = useCallback(() => {
    promptSignIn();
  }, [promptSignIn]);
  const promptAsync = useCallback(async () => {
    promptSignIn();
  }, [promptSignIn]);

  // Download is read-only — public viewers can grab the stems.
  const onDownloadAll = useCallback(async () => {
    if (!player.state.stems.length) return;
    setDownloading(true);
    try {
      const filename = `${player.state.title || 'paperstem'}-stems.zip`;
      await downloadStemsAsZip(player.state.stems, filename);
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setDownloading(false);
    }
  }, [player.state.stems, player.state.title]);

  // Keyboard shortcuts — full surface from the authenticated app. The
  // mutation paths route through promptSignIn (⌘K, M, ⇧M, C all prompt).
  useKeyboard({
    player,
    pickerOpen: false,
    drawerOpen,
    popoverOpen: activeCommentId !== null,
    annotationCreateMode: false,
    sectionCreateMode: false,
    viewport,
    onTogglePicker: promptIgnoreArgs,
    onClosePicker: () => undefined,
    onCloseDrawer: closeDrawer,
    onClosePopover: closePopovers,
    onCancelCreate: () => undefined,
    onToggleShortcuts: () => setShortcutsOpen((v) => !v),
    onAddCommentAtPlayhead: promptIgnoreArgs,
    onAddSectionAtPlayhead: promptIgnoreArgs,
    onAddEndMarkerAtPlayhead: promptIgnoreArgs,
  });

  if (state.kind === 'loading') {
    return (
      <div className="app-shell">
        <PublicLoadingShell appEnv={appInfo?.env ?? null} />
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="app-shell">
        <PublicErrorShell
          appEnv={appInfo?.env ?? null}
          status={state.status}
        />
      </div>
    );
  }

  const detail = state.detail;
  const isWide =
    typeof window !== 'undefined' ? window.innerWidth > 720 : true;
  const railCollapsed = isMobile;

  return (
    <div className="app-shell">
      {signInBanner && (
        <div className="audio-suppressed-banner" role="status">
          Signing you in… you'll come back here.
        </div>
      )}
      <AppHeader
        userEmail=""
        userInitials=""
        projectTitle={
          (detail.project.band_name
            ? `${detail.project.band_name} · `
            : '') + detail.project.name
        }
        stemCount={player.state.stems.length}
        duration={player.state.duration}
        annotationsOpen={drawerOpen}
        hasProject={player.state.stems.length > 0}
        canRename={false}
        isWide={isWide}
        appVersion={appInfo?.version ?? null}
        appEnv={appInfo?.env ?? null}
        downloading={downloading}
        debugInfo=""
        onOpenPicker={() => undefined}
        onToggleAnnotations={toggleDrawer}
        onSignOut={() => undefined}
        onReportBug={() => undefined}
        onRenameProject={() => undefined}
        onOpenTokens={() => undefined}
        onDownloadAll={() => void onDownloadAll()}
        publicMode={{ onSignIn: promptSignIn }}
      />
      <AppToolbar
        hasProject={player.state.stems.length > 0}
        isPlaying={player.state.isPlaying}
        loopEnabled={!!player.state.loop?.enabled || player.state.loopArmed}
        loopArmed={player.state.loopArmed}
        waveformNormalization={player.state.waveformNormalization}
        masterVolume={player.state.masterVolume}
        currentTime={player.currentTime}
        duration={player.state.duration}
        annotationCreateMode={false}
        canCreateAnnotations={true}
        sectionCreateMode={false}
        canCreateSections={true}
        markersVisible={true}
        railCollapsed={railCollapsed}
        showRailToggle={false}
        isWide={isWide}
        onSeek={player.seek}
        onTogglePlay={() => void player.togglePlay()}
        onToggleLoopEnabled={player.toggleLoopEnabled}
        onToggleWaveformNormalization={player.toggleWaveformNormalization}
        onToggleAnnotationCreate={promptIgnoreArgs}
        onToggleSectionCreate={promptIgnoreArgs}
        onToggleMarkersVisible={() => undefined}
        onSetMasterVolume={player.setMasterVolume}
        onToggleRailCollapsed={() => undefined}
        viewport={viewport}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      <div className="app-body">
        <div style={{ position: 'relative', minHeight: 0, minWidth: 0 }}>
          <ErrorBoundary onReportBug={() => undefined}>
            <Player
              player={player}
              annotations={annotationsForPlayer}
              userColorMap={userColorMap}
              markersVisible={true}
              annotationCreateMode={false}
              onToggleAnnotationCreate={promptIgnoreArgs}
              onAnnotationCreated={promptIgnoreArgs}
              onAnnotationSelected={handleAnnotationSelected}
              onLoopAnnotation={handleLoopAnnotation}
              pendingDraft={null}
              hoveredAnnotationId={hoveredAnnotationId}
              onHoverAnnotation={setHoveredAnnotationId}
              sections={sectionsForPlayer}
              songUseCounts={new Map()}
              activeSectionId={null}
              sectionCreateMode={false}
              onSectionSelected={handleSectionSelected}
              onSectionCreated={promptIgnoreArgs}
              onPatchSection={promptAsync}
              onPatchAnnotation={promptAsync}
              selfUserId=""
              onToggleSectionCreate={promptIgnoreArgs}
              railCollapsed={railCollapsed}
              canMutate={true}
              onOpenPicker={() => undefined}
              onRenameStem={promptIgnoreArgs}
              onDeleteStem={promptIgnoreArgs}
              viewport={viewport}
              onDismissPopovers={closePopovers}
            />
          </ErrorBoundary>
        </div>
        {(() => {
          const active = annotationsForPlayer.find(
            (a) => a.id === activeCommentId,
          ) ?? null;
          const color =
            (active && userColorMap.get(active.user_id)) ??
            SELF_ANNOTATION_COLOR;
          return (
            <>
              <CommentsDrawer
                key="public-drawer"
                open={drawerOpen}
                isNarrow={railCollapsed}
                selfUserId=""
                canEdit={true}
                annotations={annotationsForPlayer}
                userColorMap={userColorMap}
                activeId={activeCommentId}
                pendingDraft={null}
                onClose={closeDrawer}
                onSelect={handleAnnotationSelected}
                onCreate={promptIgnoreArgs}
                onDraftCancel={() => undefined}
                onToggleStar={promptIgnoreArgs}
                onSaveEdit={promptIgnoreArgs}
                onDelete={promptIgnoreArgs}
                onCopyLink={promptIgnoreArgs}
                replies={replies}
                onLoadReplies={loadReplies}
                onCreateReply={promptAsync}
                onEditReply={promptAsync}
                onDeleteReply={promptAsync}
                onToggleReaction={promptIgnoreArgs}
              />
              {!drawerOpen && (
                <CommentsFab
                  count={annotationsForPlayer.length}
                  starredCount={annotationsForPlayer.filter((a) => a.starred).length}
                  onClick={toggleDrawer}
                />
              )}
              {active && popoverAnchor && !railCollapsed &&
                createPortal(
                  <CommentPopover
                    annotation={active}
                    color={color}
                    anchorLeftPx={popoverAnchor.left}
                    anchorTopPx={popoverAnchor.top}
                    canEdit={true}
                    isOwn={false}
                    drawerOpen={drawerOpen}
                    onLoopRegion={() => handleLoopAnnotation(active)}
                    onToggleStar={promptIgnoreArgs}
                    onSaveEdit={promptIgnoreArgs}
                    onDelete={promptIgnoreArgs}
                    onCopyLink={promptIgnoreArgs}
                    onClose={closePopovers}
                    selfUserId=""
                    isNarrow={railCollapsed}
                    replies={replies.get(active.id)}
                    replyCount={active.reply_count}
                    onLoadReplies={loadReplies}
                    onCreateReply={promptAsync}
                    onEditReply={promptAsync}
                    onDeleteReply={promptAsync}
                    onToggleReaction={promptIgnoreArgs}
                  />,
                  document.body,
                )}
              {active && railCollapsed &&
                createPortal(
                  (() => {
                    const idx = annotationsForPlayer.findIndex(
                      (a) => a.id === active.id,
                    );
                    const navTo = (newIdx: number) => {
                      const a = annotationsForPlayer[newIdx];
                      if (a) handleAnnotationSelected(a);
                    };
                    return (
                      <CommentBottomSheet
                        annotation={active}
                        color={color}
                        canEdit={true}
                        isOwn={false}
                        index={idx}
                        total={annotationsForPlayer.length}
                        onPrev={() => navTo(idx - 1)}
                        onNext={() => navTo(idx + 1)}
                        onLoopRegion={() => handleLoopAnnotation(active)}
                        onToggleStar={promptIgnoreArgs}
                        onSaveEdit={promptIgnoreArgs}
                        onDelete={promptIgnoreArgs}
                        onClose={closePopovers}
                        selfUserId=""
                        replies={replies.get(active.id)}
                        replyCount={active.reply_count}
                        onLoadReplies={loadReplies}
                        onCreateReply={promptAsync}
                        onEditReply={promptAsync}
                        onDeleteReply={promptAsync}
                        onToggleReaction={promptIgnoreArgs}
                      />
                    );
                  })(),
                  document.body,
                )}
            </>
          );
        })()}
      </div>
      <ShortcutsOverlay
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}

function PublicLoadingShell({ appEnv }: { appEnv: string | null }) {
  const envBadge = appEnv && appEnv !== 'prod' ? `[${appEnv.toUpperCase()}] ` : '';
  return (
    <header className="app-header">
      <h1 className="ah-brand">{envBadge}Paperstem</h1>
      <span className="ah-spacer" />
      <span className="ah-meta">Loading…</span>
    </header>
  );
}

function PublicErrorShell({
  appEnv,
  status,
}: {
  appEnv: string | null;
  status: number;
}) {
  const envBadge = appEnv && appEnv !== 'prod' ? `[${appEnv.toUpperCase()}] ` : '';
  return (
    <>
      <header className="app-header">
        <h1 className="ah-brand">{envBadge}Paperstem</h1>
        <span className="ah-spacer" />
      </header>
      <main className="empty-state">
        <h2>Link unavailable</h2>
        <p>
          {status === 410
            ? "This share link has been revoked, or the project has been removed. Ask the person who sent it for a new link."
            : "This share link doesn't seem to point at anything. Double-check the URL."}
        </p>
        <p>
          <a href="/">Open Paperstem</a>
        </p>
      </main>
    </>
  );
}

export function PublicProjectRouteWrapper() {
  const token = readTokenFromPath();
  if (!token) return null;
  return <PublicProjectView token={token} />;
}

// Suppress an unused-pseudoUserId warning if it ever happens — exported so
// the helper is also reachable from tests.
export const _internal = { pseudoUserId };
