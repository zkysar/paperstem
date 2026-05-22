import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
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
import { ShareArrivalBanner } from './components/ShareArrivalBanner';
import type { ShareArrivalCategory } from './components/ShareArrivalBanner';
import { ShareDialog } from './components/ShareDialog';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import {
  fetchPublicAnnotations,
  fetchPublicProject,
  fetchPublicReplies,
  fetchPublicSections,
  probeMembership,
  publicAudioUrl,
  type MembershipProbe,
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
import { PresenceContext, usePresentIn } from './hooks/usePresenceConnection';
import { useViewport } from './hooks/useViewport';
import { createPresenceClient } from './lib/presence-client';
import { buildUserColorMap, SELF_ANNOTATION_COLOR } from './lib/colors';
import { downloadStemsAsZip } from './lib/download';
import { decodePeaks } from './lib/peaks';
import { stashReturnPath } from './lib/public-return';
import { applyShareState } from './lib/apply-share-state';
import {
  decodePublicShareFragment,
  snapshotShareState,
  type ShareState,
} from './lib/share-url';
import { buildDocumentTitle } from './lib/document-title';

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
  const [noAccessBanner, setNoAccessBanner] = useState(false);
  const [signInPromptOpen, setSignInPromptOpen] = useState(false);
  // Tri-state set by the bootstrap effect — drives whether the header
  // shows "Sign in" (anonymous) or a "no access" treatment (signed-in
  // but not a band member). 'signed-in-member' is never observed here
  // because we redirect to /#p=<id> instantly when we see it.
  const [probe, setProbe] = useState<MembershipProbe>({ kind: 'anonymous' });

  // Share-link view-state. The URL hash (e.g. #t=83&fc=cmt&mix=…) is captured
  // once on mount, decoded against this project once it loads, and applied to
  // the player. `arrival` drives the banner; the dialog state powers the
  // outgoing "share this moment" flow.
  const initialHashRef = useRef<string>(
    typeof window !== 'undefined' ? window.location.hash : '',
  );
  const pendingShareRef = useRef<ShareState | null>(null);
  const arrivalAppliedRef = useRef(false);
  const [arrival, setArrival] = useState<{
    time: number | null;
    categories: ShareArrivalCategory[];
  } | null>(null);
  const [shareState, setShareState] = useState<ShareState | null>(null);
  const [shareAnnotation, setShareAnnotation] = useState<Annotation | null>(null);

  // Reflect the shared project in the tab/page title once it loads, instead
  // of leaving the static "Paperstem" from index.html.
  const publicProjectTitle =
    state.kind === 'ready' ? state.detail.project.name : null;
  useEffect(() => {
    document.title = buildDocumentTitle(appInfo?.env, publicProjectTitle);
  }, [appInfo?.env, publicProjectTitle]);

  const presenceClient = useMemo(
    () => createPresenceClient({ linkToken: token }),
    [token],
  );
  useEffect(() => {
    presenceClient.connect();
    return () => { presenceClient.disconnect(); };
  }, [presenceClient]);

  // Show a confirmation modal before bouncing to the magic-link flow.
  // Originally this navigated immediately — viewers found that jarring
  // (a click on "star" silently sent them to a sign-in page). Now we
  // pop a modal; the modal's primary button stashes the return path
  // and assigns location. Signed-in non-members never get the modal —
  // there's nowhere useful to navigate them, so we show a banner that
  // explains the situation instead.
  const promptSignIn = useCallback(() => {
    if (probe.kind === 'signed-in-non-member') {
      setNoAccessBanner(true);
      return;
    }
    setSignInPromptOpen(true);
  }, [probe.kind]);

  const confirmSignIn = useCallback(() => {
    stashReturnPath(window.location.pathname);
    window.location.assign('/');
  }, []);

  // Bootstrap fetch: project metadata, then membership probe. If a
  // signed-in member, redirect immediately to /#p=<id>. Otherwise hold
  // the probe result so the header can render the right CTA.
  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      try {
        const detail = await fetchPublicProject(token);
        if (cancelled) return;

        const membership = await probeMembership(detail.project.id);
        if (cancelled) return;
        if (membership.kind === 'signed-in-member') {
          // Forward any shared view-state into the authenticated hash format
          // (`#p=<id>&<frag>`) so the member lands on the same moment rather
          // than a bare project. The public fragment carries no `p=`, so the
          // injected project id wins in URLSearchParams either way.
          const base = `/#p=${encodeURIComponent(detail.project.id)}`;
          const frag = initialHashRef.current.replace(/^#/, '');
          window.location.assign(frag ? `${base}&${frag}` : base);
          return;
        }
        setProbe(membership);

        setState({ kind: 'ready', detail });

        // Decode any share-link state from the hash now that we know the
        // project id (the token, not the hash, carries it). The drain effect
        // below applies it once the player has decoded its stems.
        const pending = decodePublicShareFragment(
          initialHashRef.current,
          detail.project.id,
        );
        if (pending) {
          pendingShareRef.current = pending;
          history.replaceState(
            null,
            '',
            window.location.pathname + window.location.search,
          );
        }

        const sources: StemSource[] = detail.stems.map((s) => ({
          name: s.name,
          src: publicAudioUrl(token, s.id),
          serverId: s.id,
          peaks: s.peaks ? decodePeaks(s.peaks) : null,
          durationMs: s.duration_ms,
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

  // Drain the pending share state once the project's stems are decoded (mix
  // matching needs them) and, if a view was shared, the stage is measured.
  // Mirrors the authenticated app's arrival flow. Playback stays paused.
  useEffect(() => {
    if (arrivalAppliedRef.current) return;
    const pending = pendingShareRef.current;
    if (!pending) return;
    if (player.state.projectId !== pending.projectId) return;
    if (player.state.stems.length === 0) return;
    if (
      (pending.view || pending.trackHeight != null) &&
      viewport.state.stageWidth === 0
    ) {
      return;
    }
    arrivalAppliedRef.current = true;
    const result = applyShareState(pending, {
      player,
      viewport,
      onFocusComment: (id) => setActiveCommentId(id),
      onOpenDrawer: () => setDrawerOpen(true),
    });
    pendingShareRef.current = null;
    const hasNonTrivial =
      (result.time != null && result.time > 0) ||
      result.appliedCategories.length > 0;
    if (hasNonTrivial) {
      setArrival({ time: result.time, categories: result.appliedCategories });
    }
  }, [player, viewport]);

  // Dismiss the arrival banner once playback starts.
  useEffect(() => {
    if (arrival && player.state.isPlaying) setArrival(null);
  }, [arrival, player.state.isPlaying]);

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

  // Build a ShareState from the live player + UI so a viewer can hand the
  // current moment (time, loop, mix, zoom, focused comment) to someone else
  // as a /p/<token>#… link. The project id comes from the loaded player.
  const buildSnapshot = useCallback(
    (overrides?: { time?: number; focusedCommentId?: string }) => {
      const projectId = player.state.projectId;
      if (!projectId) return null;
      return snapshotShareState(
        {
          projectId,
          player: player.state,
          currentTime: player.currentTime,
          activeCommentId,
          viewport: {
            hZoom: viewport.state.hZoom,
            trackHeight: viewport.state.trackHeight,
            scrollLeft: viewport.state.scrollLeft,
            stageWidth: viewport.state.stageWidth,
            railWidth: viewport.state.railWidth,
          },
        },
        overrides,
      );
    },
    [player.state, player.currentTime, activeCommentId, viewport.state],
  );

  const handleOpenShare = useCallback(() => {
    const snap = buildSnapshot();
    if (!snap) return;
    const focused = snap.focusedCommentId
      ? annotationsForPlayer.find((a) => a.id === snap.focusedCommentId) ?? null
      : null;
    setShareState(snap);
    setShareAnnotation(focused);
  }, [buildSnapshot, annotationsForPlayer]);

  const handleCopyCommentLink = useCallback(
    (a: Annotation) => {
      const snap = buildSnapshot({
        time: a.start_ms / 1000,
        focusedCommentId: a.id,
      });
      if (!snap) return;
      setShareState(snap);
      setShareAnnotation(a);
    },
    [buildSnapshot],
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
    <PresenceContext.Provider value={presenceClient}>
      <PublicPresenceSubscriber projectId={detail.project.id} />
    <div className="app-shell">
      {/* Page heading reflecting the shared project — the brand in AppHeader
          is a styled <span>, not a heading. */}
      <h1 className="sr-only">{detail.project.name}</h1>
      {arrival && (
        <ShareArrivalBanner
          time={arrival.time}
          categories={arrival.categories}
          onPlay={() => {
            setArrival(null);
            void player.togglePlay();
          }}
          onDismiss={() => setArrival(null)}
        />
      )}
      {noAccessBanner && (
        <div className="public-signin-banner" role="status">
          You're signed in but don't have access to this project. Ask the
          owner to add you to their group.
        </div>
      )}
      {signInPromptOpen && (
        <SignInPrompt
          projectTitle={detail.project.name}
          onConfirm={confirmSignIn}
          onCancel={() => setSignInPromptOpen(false)}
        />
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
        publicMode={{
          onSignIn: promptSignIn,
          // Signed-in-non-member: relabel the action so we don't claim
          // sign-in helps. Tapping it surfaces the same "no access"
          // banner the toolbar prompts do.
          label:
            probe.kind === 'signed-in-non-member'
              ? 'No access'
              : 'Sign in',
        }}
      />
      <AppToolbar
        hasProject={player.state.stems.length > 0}
        isPlaying={player.state.isPlaying}
        audioLoading={player.state.loading !== null}
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
        onShare={handleOpenShare}
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
              canMutate={false}
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
                selfDisplayName=""
                selfColor="#888"
                canEdit={true}
                canReact={false}
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
                onCopyLink={handleCopyCommentLink}
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
              {active && popoverAnchor && !railCollapsed && !drawerOpen &&
                createPortal(
                  <div
                    data-testid="comment-popover-scrim"
                    className="surface-scrim"
                    role="presentation"
                    aria-hidden="true"
                    onClick={closePopovers}
                  />,
                  document.body,
                )}
              {active && popoverAnchor && !railCollapsed &&
                createPortal(
                  <CommentPopover
                    annotation={active}
                    color={color}
                    anchorLeftPx={popoverAnchor.left}
                    anchorTopPx={popoverAnchor.top}
                    canEdit={true}
                    canReact={false}
                    isOwn={false}
                    drawerOpen={drawerOpen}
                    onLoopRegion={() => handleLoopAnnotation(active)}
                    onToggleStar={promptIgnoreArgs}
                    onSaveEdit={promptIgnoreArgs}
                    onDelete={promptIgnoreArgs}
                    onCopyLink={() => handleCopyCommentLink(active)}
                    onClose={closePopovers}
                    selfUserId=""
                    selfDisplayName=""
                    selfColor="#888"
                    userColorMap={userColorMap}
                    isNarrow={railCollapsed}
                    replies={replies.get(active.id)}
                    onLoadReplies={loadReplies}
                    onCreateReply={promptAsync}
                    onEditReply={promptAsync}
                    onDeleteReply={promptAsync}
                    onToggleReaction={promptIgnoreArgs}
                  />,
                  document.body,
                )}
              {active && railCollapsed && !drawerOpen &&
                createPortal(
                  <div
                    data-testid="comment-sheet-scrim"
                    className="surface-scrim"
                    role="presentation"
                    aria-hidden="true"
                    onClick={closePopovers}
                  />,
                  document.body,
                )}
              {active && railCollapsed && !drawerOpen &&
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
                        canReact={false}
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
                        selfDisplayName=""
                        selfColor="#888"
                        userColorMap={userColorMap}
                        replies={replies.get(active.id)}
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
      <ShareDialog
        open={shareState !== null}
        state={shareState ?? { projectId: '' }}
        focusedAnnotation={shareAnnotation}
        publicToken={token}
        onClose={() => setShareState(null)}
      />
    </div>
    </PresenceContext.Provider>
  );
}

function SignInPrompt({
  projectTitle,
  onConfirm,
  onCancel,
}: {
  projectTitle: string;
  onConfirm(): void;
  onCancel(): void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="upload-modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="public-signin-title"
      onClick={onCancel}
    >
      <div className="upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="upload-modal-header">
          <h2 id="public-signin-title">Sign in to interact</h2>
          <button
            type="button"
            className="upload-modal-close"
            aria-label="Close"
            onClick={onCancel}
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div className="upload-modal-body">
          <p className="upload-hint">
            You're viewing <strong>{projectTitle}</strong> as a guest. Sign in
            to comment, react, add sections, or star anything. You'll come
            back to this page after signing in.
          </p>
          <div className="create-group-actions">
            <button
              type="button"
              className="create-group-submit"
              onClick={onConfirm}
              autoFocus
            >
              Sign in
            </button>
            <button type="button" onClick={onCancel}>
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PublicPresenceSubscriber({ projectId }: { projectId: string }) {
  usePresentIn(projectId);
  return null;
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
