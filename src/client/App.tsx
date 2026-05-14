import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoginScreen } from './auth/LoginScreen';
import { useBands } from './auth/useBands';
import { useSession } from './auth/useSession';
import { PENDING_SHARE_HASH_KEY, useShareLink } from './hooks/useShareLink';
import { applyShareState } from './lib/apply-share-state';
import {
  ShareArrivalBanner,
  type ShareArrivalCategory,
} from './components/ShareArrivalBanner';
import {
  snapshotShareState,
  type ShareState,
} from './lib/share-url';
import { CommentsDrawer, type DraftSpec } from './components/CommentsDrawer';
import { CommentsFab } from './components/CommentsFab';
import { CommentPopover } from './components/CommentPopover';
import { CommentBottomSheet } from './components/CommentBottomSheet';
import { createPortal } from 'react-dom';
import { AppHeader } from './components/AppHeader';
import { AppToolbar } from './components/AppToolbar';
import {
  BugReportDrawer,
  type BugReportPrefill,
} from './components/BugReportDrawer';
import { TokensDrawer } from './components/TokensDrawer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FilePicker } from './components/FilePicker';
import { Player } from './components/Player';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { ShareDialog } from './components/ShareDialog';
import { UploadDrawer } from './components/UploadDrawer';
import {
  listAnnotations,
  createAnnotation,
  patchAnnotation,
  deleteAnnotation,
} from './data/annotations-repo';
import { HttpProjectsRepo, type ProjectsRepo } from './data/projects-repo';
import type { Project, StemSource, TrashList } from './data/types';
import { decodePeaks } from './lib/peaks';
import { useAppVersion } from './hooks/useAppVersion';
import { useKeyboard } from './hooks/useKeyboard';
import { usePlayer } from './hooks/usePlayer';
import { useViewport } from './hooks/useViewport';
import { buildUserColorMap } from './lib/colors';
import { downloadStemsAsZip } from './lib/download';
import type { Annotation, User } from '../shared/types';

const UPLOAD_MIN_VIEWPORT_PX = 720;

function initialsFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return local.slice(0, 2).toUpperCase();
}

export default function App() {
  const { user, loading, logout } = useSession();
  const appInfo = useAppVersion();

  useEffect(() => {
    const env = appInfo?.env;
    if (env && env !== 'prod') {
      document.title = `[${env.toUpperCase()}] Paperstem`;
      document.body.classList.add('env-non-prod');
      document.body.dataset.env = env;
    } else {
      document.title = 'Paperstem';
      document.body.classList.remove('env-non-prod');
      delete document.body.dataset.env;
    }
  }, [appInfo?.env]);

  // Magic-link login is a fresh server navigation that drops the fragment.
  // Stash it in sessionStorage before rendering LoginScreen so PaperstemApp
  // can pick it up after auth completes.
  useEffect(() => {
    if (loading || user) return;
    const hash = window.location.hash;
    if (hash && hash !== '#') {
      try {
        sessionStorage.setItem(PENDING_SHARE_HASH_KEY, hash);
      } catch {
        // sessionStorage may be unavailable — best-effort.
      }
    }
  }, [loading, user]);

  if (loading) return null;
  if (!user) return <LoginScreen />;
  return <PaperstemApp user={user} onLogout={logout} appInfo={appInfo} />;
}

function PaperstemApp({
  user,
  onLogout,
  appInfo,
}: {
  user: User;
  onLogout: () => void;
  appInfo: ReturnType<typeof useAppVersion>;
}) {
  const player = usePlayer();
  const viewport = useViewport();
  const shareLink = useShareLink();
  const pendingShareStateRef = useRef(shareLink.initial);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [showZoomHint, setShowZoomHint] = useState<boolean>(() => {
    try {
      return localStorage.getItem('paperstem.hints.zoom.seen') !== '1';
    } catch {
      return false;
    }
  });

  const dismissZoomHint = useCallback(() => {
    setShowZoomHint(false);
    try {
      localStorage.setItem('paperstem.hints.zoom.seen', '1');
    } catch {
      // ignore
    }
  }, []);

  const { bands, loading: bandsLoading, error: bandsError } = useBands(true);
  const activeBand = bands[0] ?? null;
  const activeBandId = activeBand?.id ?? null;
  const repo = useMemo<ProjectsRepo | null>(
    () => (activeBandId ? new HttpProjectsRepo(activeBandId) : null),
    [activeBandId],
  );

  const [projects, setProjects] = useState<Project[]>([]);
  const [trash, setTrash] = useState<TrashList | null>(null);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    shareLink.initial?.projectId ?? null,
  );
  const [downloading, setDownloading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  // Draft mode: when the user picks a folder via "+ New project", the audio
  // plays from local File objects (object URLs). We keep the underlying Files
  // around so "Save to band" can hand them to UploadDrawer for promotion.
  const [draftFiles, setDraftFiles] = useState<File[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [annotationCreateMode, setAnnotationCreateMode] = useState(false);
  const [markersVisible, setMarkersVisible] = useState(true);
  const [pendingDraft, setPendingDraft] = useState<DraftSpec | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<{ left: number; top: number } | null>(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(
    null,
  );
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [bugReportPrefill, setBugReportPrefill] = useState<BugReportPrefill | null>(null);
  // Arrival banner state — populated when a share link applies non-trivial
  // player state. Cleared on first manual play or explicit dismiss.
  const [arrival, setArrival] = useState<
    { time: number | null; categories: ShareArrivalCategory[] } | null
  >(null);
  // The comment id that arrived via `fc=` on a share link. Set briefly so the
  // matching row/popover pulses, then cleared by a timeout so the emphasis
  // doesn't persist as the user navigates.
  const [emphasizedCommentId, setEmphasizedCommentId] = useState<string | null>(null);
  const [tokensOpen, setTokensOpen] = useState(false);

  const openBugReport = useCallback((prefill: BugReportPrefill | null = null) => {
    setBugReportPrefill(prefill);
    setBugReportOpen(true);
  }, []);
  const closeBugReport = useCallback(() => {
    setBugReportOpen(false);
    setBugReportPrefill(null);
  }, []);

  const lastPickerTriggerRef = useRef<HTMLElement | null>(null);
  const lastDrawerTriggerRef = useRef<HTMLElement | null>(null);

  const openPicker = useCallback(() => {
    lastPickerTriggerRef.current = document.activeElement as HTMLElement | null;
    setPickerOpen(true);
  }, []);
  const closePicker = useCallback(() => {
    setPickerOpen(false);
    queueMicrotask(() => lastPickerTriggerRef.current?.focus());
  }, []);

  const openDrawer = useCallback(() => {
    lastDrawerTriggerRef.current = document.activeElement as HTMLElement | null;
    setDrawerOpen(true);
  }, []);
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setPendingDraft(null);
    queueMicrotask(() => lastDrawerTriggerRef.current?.focus());
  }, []);
  const toggleDrawer = useCallback(() => {
    if (drawerOpen) closeDrawer();
    else openDrawer();
  }, [drawerOpen, openDrawer, closeDrawer]);

  // Auto-open the picker once on mount when no project is active.
  useEffect(() => {
    if (activeProjectId === null) setPickerOpen(true);
    // intentionally fires once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live-sync the address bar to `#p=<id>` whenever the active project
  // changes. The hook's syncProjectId is stable.
  useEffect(() => {
    shareLink.syncProjectId(activeProjectId);
  }, [activeProjectId, shareLink]);

  // When activeProjectId transitions to null (e.g. the active project was
  // deleted), reset the player so the header and waveform don't point at a
  // tombstone. Guarded with a ref so the initial null on mount doesn't fire
  // clear() before anything has been loaded.
  const prevActiveProjectIdRef = useRef<string | null>(activeProjectId);
  useEffect(() => {
    if (prevActiveProjectIdRef.current !== null && activeProjectId === null) {
      player.clear();
    }
    prevActiveProjectIdRef.current = activeProjectId;
  }, [activeProjectId, player]);

  useKeyboard({
    player,
    pickerOpen,
    drawerOpen,
    popoverOpen: activeCommentId !== null,
    annotationCreateMode,
    viewport,
    onTogglePicker: () => (pickerOpen ? closePicker() : openPicker()),
    onClosePicker: closePicker,
    onCloseDrawer: closeDrawer,
    onClosePopover: () => { setActiveCommentId(null); setPopoverAnchor(null); },
    onCancelCreate: () => {
      setAnnotationCreateMode(false);
      setPendingDraft(null);
    },
    onToggleShortcuts: () => setShortcutsOpen((v) => !v),
    onAddCommentAtPlayhead: () => {
      if (!activeProjectId) return;
      const startMs = Math.round(player.currentTime * 1000);
      handleAnnotationCreated(startMs, null);
    },
  });

  const userColorMap = useMemo(
    () => buildUserColorMap(annotations.map((a) => a.user_id), user.id),
    [annotations, user.id],
  );

  const [isWide, setIsWide] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia(`(min-width: ${UPLOAD_MIN_VIEWPORT_PX + 1}px)`).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(`(min-width: ${UPLOAD_MIN_VIEWPORT_PX + 1}px)`);
    const update = () => setIsWide(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  // The per-stem rail (track names + volume sliders + M/S pills) auto-collapses
  // on narrow viewports so the waveform takes the full width. The manual toggle
  // in AppToolbar (Task 5) overrides this until the viewport next crosses the
  // breakpoint, at which point we follow the new default again. Lifted here
  // (from Player) so AppToolbar's rail-toggle button can drive Player.
  const [railCollapsed, setRailCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 720px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 720px)');
    let last = mql.matches;
    const update = () => {
      const next = window.matchMedia('(max-width: 720px)').matches;
      if (next !== last) {
        last = next;
        setRailCollapsed(next);
      }
    };
    mql.addEventListener('change', update);
    window.addEventListener('resize', update);
    // matchMedia 'change' and window 'resize' aren't reliably dispatched
    // by every embed environment (e.g. CDP-driven viewport overrides);
    // ResizeObserver on the root element catches those cases.
    const ro = new ResizeObserver(update);
    ro.observe(document.documentElement);
    return () => {
      mql.removeEventListener('change', update);
      window.removeEventListener('resize', update);
      ro.disconnect();
    };
  }, []);

  const showUploadButton =
    isWide && activeBand !== null && activeBand.role === 'owner';

  useEffect(() => {
    if (!repo) {
      setProjects([]);
      setProjectsLoading(false);
      return;
    }
    let cancelled = false;
    setProjectsLoading(true);
    repo.list().then(
      (list) => {
        if (cancelled) return;
        setProjects(list);
        setLoadError(null);
        setProjectsLoading(false);
      },
      (err: Error) => {
        if (cancelled) return;
        setLoadError(err.message);
        setProjectsLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repo]);

  async function refreshProjects(): Promise<Project[]> {
    if (!repo) return [];
    try {
      const list = await repo.list();
      setProjects(list);
      setLoadError(null);
      setProjectsLoading(false);
      return list;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg);
      setProjectsLoading(false);
      throw err;
    }
  }

  async function handleUploaded(projectId: string) {
    setUploadOpen(false);
    setDraftFiles([]);
    try {
      await refreshProjects();
      await selectProject(projectId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg);
    }
  }

  const deleteProject = useCallback(
    async (id: string) => {
      if (!repo) return;
      let prev: Project[] = [];
      setProjects((arr) => {
        prev = arr;
        return arr.filter((p) => p.id !== id);
      });
      if (activeProjectId === id) {
        setActiveProjectId(null);
        // Reset the player explicitly so the header and waveform clear before
        // the activeProjectId effect fires on the next render — keeps the UI
        // from briefly displaying the deleted project's metadata.
        player.clear();
        setActiveCommentId(null);
        setPopoverAnchor(null);
        setAnnotations([]);
      }
      try {
        await repo.deleteProject(id);
      } catch (err) {
        console.error('delete failed', err);
        setProjects(prev);
      }
    },
    [repo, activeProjectId, player],
  );

  const loadTrash = useCallback(async () => {
    if (!repo) return;
    try {
      const data = await repo.listTrash();
      setTrash(data);
      setTrashError(null);
    } catch (err) {
      console.error('trash load failed', err);
      // Surface the error in the UI instead of silently rendering "empty".
      // Leave `trash` as-is so a previously-good list doesn't disappear on a
      // transient failure.
      setTrashError(err instanceof Error ? err.message : 'load failed');
    }
  }, [repo]);

  const restoreProject = useCallback(
    async (id: string) => {
      if (!repo) return;
      try {
        await repo.restoreProject(id);
      } catch (err) {
        console.error('restore failed', err);
        return;
      }
      try {
        const fresh = await repo.list();
        setProjects(fresh);
      } catch (_err) { /* ignore */ }
      await loadTrash();
    },
    [repo, loadTrash],
  );

  // Core: fetch a project by id and populate player + annotations. Shared by
  // selectProject (user-driven switch) and reloadActive (refresh the current
  // project in place — used after stem restore / failed stem delete to bring
  // server truth back into the player without resetting create-mode etc).
  const loadProject = useCallback(
    async (id: string, opts: { resetUiState: boolean }) => {
      if (!repo) return;
      if (opts.resetUiState) {
        setAnnotations([]);
        setPendingDraft(null);
        setAnnotationCreateMode(false);
        setActiveCommentId(null);
        setPopoverAnchor(null);
        // Reset zoom/scroll/follow so the new project lands at t=0 in the
        // visible window. Without this, a prior project's scrollLeft can
        // place t=0 behind the sticky rail, hiding the playhead and its
        // handle until the user manually pans back. Share-link loads
        // re-apply their saved view in a later effect, so this reset is
        // safe in that path too.
        viewport.fitToWindow();
      }
      try {
        const detail = await repo.getById(id);
        setProjects((prev) => prev.map((p) => (p.id === detail.id ? detail : p)));
        const sources: StemSource[] = detail.stems.map((s) => ({
          name: s.name,
          src: `/api/audio/${encodeURIComponent(s.id)}`,
          serverId: s.id,
          peaks: s.peaks ? decodePeaks(s.peaks) : null,
        }));
        void player.load({
          projectId: detail.id,
          title: detail.title,
          folderId: detail.folderId,
          sources,
        });
        try {
          const list = await listAnnotations(id);
          setAnnotations(list);
        } catch (err) {
          console.error('Failed to load annotations:', err);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(msg);
      }
    },
    [repo, player, viewport],
  );

  const reloadActive = useCallback(async () => {
    if (!activeProjectId) return;
    await loadProject(activeProjectId, { resetUiState: false });
  }, [activeProjectId, loadProject]);

  // On mount, if a share link supplied a project ID, load it. The picker's
  // auto-open effect already skipped because activeProjectId was non-null
  // from the share link. We just need to fetch the project.
  const didInitialShareLoadRef = useRef(false);
  useEffect(() => {
    if (didInitialShareLoadRef.current) return;
    const initial = pendingShareStateRef.current;
    if (!initial || !repo) return;
    didInitialShareLoadRef.current = true;
    // Don't reset UI state — we want the share link's focused comment etc. to
    // survive once Task 4 wires the drain. resetUiState: true is safe here
    // because the share state hasn't been applied yet.
    void loadProject(initial.projectId, { resetUiState: true });
  }, [repo, loadProject]);

  // Drain pendingShareStateRef once the active project is fully loaded
  // (stems decoded). Player stays paused; recipient drives playback.
  // Sets arrival banner state when anything beyond `p` was applied.
  useEffect(() => {
    const pending = pendingShareStateRef.current;
    if (!pending) return;
    if (player.state.projectId !== pending.projectId) return;
    if (player.state.stems.length === 0) return;
    // If the share state carries a view (zoom + scroll), wait for the player
    // stage to be measured so the recipient lands on the exact same time
    // window the sharer was looking at, regardless of screen size.
    if ((pending.view || pending.trackHeight != null) && viewport.state.stageWidth === 0) return;

    const result = applyShareState(pending, {
      player,
      viewport,
      onFocusComment: (id) => {
        setActiveCommentId(id);
        setEmphasizedCommentId(id);
        window.setTimeout(() => setEmphasizedCommentId(null), 3000);
      },
      onOpenDrawer: () => openDrawer(),
    });
    pendingShareStateRef.current = null;

    const hasNonTrivial =
      (result.time != null && result.time > 0) || result.appliedCategories.length > 0;
    if (hasNonTrivial) {
      setArrival({ time: result.time, categories: result.appliedCategories });
    }
  }, [player, openDrawer, viewport]);

  // Auto-dismiss the arrival banner once playback starts (either via the
  // banner's ▶ Listen button or any manual play).
  useEffect(() => {
    if (arrival && player.state.isPlaying) setArrival(null);
  }, [arrival, player.state.isPlaying]);

  const restoreStem = useCallback(
    async (id: string) => {
      if (!repo) return;
      try {
        await repo.restoreStem(id);
      } catch (err) {
        console.error('restore stem failed', err);
        return;
      }
      await loadTrash();
      await reloadActive();
    },
    [repo, loadTrash, reloadActive],
  );

  const renameStem = useCallback(
    async (serverId: string, name: string) => {
      if (!repo) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      const prev = player.state.stems.find((s) => s.serverId === serverId)?.displayName;
      player.renameStem(serverId, trimmed);
      try {
        await repo.renameStem(serverId, trimmed);
      } catch (err) {
        console.error('rename stem failed', err);
        if (prev !== undefined) player.renameStem(serverId, prev);
      }
    },
    [repo, player],
  );

  const deleteStem = useCallback(
    async (serverId: string) => {
      if (!repo) return;
      player.removeStem(serverId);
      try {
        await repo.deleteStem(serverId);
      } catch (err) {
        console.error('delete stem failed', err);
        // Best-effort recovery: re-load the active project from the server so
        // the optimistic removal is reverted with authoritative data.
        await reloadActive();
      }
    },
    [repo, player, reloadActive],
  );

  const renameProject = useCallback(
    async (id: string, name: string) => {
      if (!repo) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      let prev: Project[] = [];
      setProjects((arr) => {
        prev = arr;
        return arr.map((p) => (p.id === id ? { ...p, title: trimmed } : p));
      });
      // Reflect the rename in the player title too (header reads player.state.title).
      player.setTitle(trimmed);
      try {
        await repo.renameProject(id, trimmed);
      } catch (err) {
        console.error('rename failed', err);
        setProjects(prev);
        const reverted = prev.find((p) => p.id === id);
        if (reverted) player.setTitle(reverted.title);
      }
    },
    [repo, player],
  );

  const selectProject = useCallback(
    async (id: string) => {
      if (!repo) return;
      setActiveProjectId(id);
      setDraftFiles([]);
      await loadProject(id, { resetUiState: true });
    },
    [repo, loadProject],
  );

  const handleAnnotationCreated = useCallback(
    (start_ms: number, end_ms: number | null) => {
      setAnnotationCreateMode(false);
      setPendingDraft({ start_ms, end_ms });
      setDrawerOpen(true);
    },
    [],
  );

  const handleAddButton = useCallback(() => {
    if (railCollapsed) {
      const startMs = Math.round(player.currentTime * 1000);
      handleAnnotationCreated(startMs, null);
    } else {
      setAnnotationCreateMode((v) => !v);
    }
  }, [railCollapsed, player, handleAnnotationCreated]);

  const handleAnnotationSelected = useCallback(
    (annotation: Annotation) => {
      player.seek(annotation.start_ms / 1000);
      setActiveCommentId(annotation.id);
      queueMicrotask(() => {
        const el = document.querySelector(
          `[data-annotation-id="${annotation.id}"]`,
        ) as HTMLElement | null;
        if (!el) {
          setPopoverAnchor(null);
          return;
        }
        const r = el.getBoundingClientRect();
        setPopoverAnchor({ left: r.left + r.width / 2, top: r.top });
      });
    },
    [player],
  );

  const handleLoopAnnotation = useCallback(
    (annotation: Annotation) => {
      if (annotation.end_ms === null) return;
      const start = annotation.start_ms / 1000;
      const end = annotation.end_ms / 1000;
      player.setLoop(start, end);
      player.setLoopEnabled(true);
      player.seek(start);
    },
    [player],
  );

  // Share dialog state. Non-null while the dialog is open; the snapshot is
  // captured at open time so toggling state inside the dialog can't be
  // influenced by ongoing playback or zoom changes underneath.
  const [shareDialog, setShareDialog] = useState<{
    state: ShareState;
    focusedAnnotation: Annotation | null;
  } | null>(null);

  // Build a ShareState snapshot from the current player + UI state. Used by
  // both the toolbar Share button and the comment copy-link flow.
  const snapshotCurrent = useCallback((overrides?: { time?: number; focusedCommentId?: string }) => {
    if (!activeProjectId) return null;
    return snapshotShareState(
      {
        projectId: activeProjectId,
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
  }, [activeProjectId, player.state, player.currentTime, activeCommentId, viewport.state]);

  // Toolbar Share button: open the dialog with the current snapshot.
  // The dialog itself handles toggles + clipboard write.
  const handleShareSnapshot = useCallback(() => {
    const state = snapshotCurrent();
    if (!state) return;
    const focused = state.focusedCommentId
      ? annotations.find((a) => a.id === state.focusedCommentId) ?? null
      : null;
    setShareDialog({ state, focusedAnnotation: focused });
  }, [snapshotCurrent, annotations]);

  // Comment copy-link: open the dialog pinned to the comment. Time + focus
  // are overridden so the snapshot reflects the comment rather than the
  // live playhead, even if the user clicked while playback was elsewhere.
  const handleCopyCommentLink = useCallback((a: Annotation) => {
    const state = snapshotCurrent({ time: a.start_ms / 1000, focusedCommentId: a.id });
    if (!state) return;
    setShareDialog({ state, focusedAnnotation: a });
  }, [snapshotCurrent]);

  async function handleToggleStar(a: Annotation): Promise<void> {
    const prev = annotations;
    const optimistic = annotations.map((x) =>
      x.id === a.id ? { ...x, starred: !x.starred } : x,
    );
    setAnnotations(optimistic);
    try {
      const updated = await patchAnnotation(a.id, { starred: !a.starred });
      setAnnotations((cur) => cur.map((x) => (x.id === updated.id ? updated : x)));
    } catch {
      setAnnotations(prev);
    }
  }

  async function handleSaveEdit(a: Annotation, body: string): Promise<void> {
    const updated = await patchAnnotation(a.id, { body });
    setAnnotations((cur) => cur.map((x) => (x.id === updated.id ? updated : x)));
  }

  async function handleDelete(a: Annotation): Promise<void> {
    await deleteAnnotation(a.id);
    setAnnotations((cur) => cur.filter((x) => x.id !== a.id));
    if (activeCommentId === a.id) {
      setActiveCommentId(null);
      setPopoverAnchor(null);
    }
  }

  async function handleCreateFromDraft(body: string): Promise<void> {
    if (!activeProjectId || !pendingDraft) return;
    const created = await createAnnotation(activeProjectId, {
      start_ms: pendingDraft.start_ms,
      end_ms: pendingDraft.end_ms,
      body,
    });
    setAnnotations((cur) =>
      [...cur, created].sort(
        (x, y) => x.start_ms - y.start_ms || x.created_at - y.created_at,
      ),
    );
    setPendingDraft(null);
  }

  function loadFolder(files: File[], folderName: string) {
    if (!files.length) {
      setDraftFiles([]);
      void player.load({
        projectId: null,
        title: folderName || 'Local folder',
        folderId: null,
        sources: [],
      });
      return;
    }
    const sources: StemSource[] = files.map((f) => {
      const url = URL.createObjectURL(f);
      return { name: f.name, src: url, revoke: () => URL.revokeObjectURL(url) };
    });
    setActiveProjectId(null);
    setDraftFiles(files);
    void player.load({
      projectId: `local:${folderName}`,
      title: folderName,
      folderId: null,
      sources,
    });
  }

  async function onDownloadAll() {
    if (!player.state.stems.length) return;
    setDownloading(true);
    try {
      const filename = `${activeProjectId || 'paperstem'}-stems.zip`;
      await downloadStemsAsZip(player.state.stems, filename);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Download failed:', msg);
    } finally {
      setDownloading(false);
    }
  }

  if (bandsLoading) return null;

  if (!bandsLoading && bands.length === 0) {
    return (
      <>
        <header className="topbar">
          <h1 className="brand">Paperstem</h1>
          <span className="topbar-spacer" />
          <button type="button" className="logout-btn" onClick={onLogout}>
            Sign out
          </button>
        </header>
        <div className="app">
          <main className="empty-state">
            <p>You're not in any bands yet. Ask your band's owner to add you.</p>
            {bandsError && <p className="error">Could not load bands ({bandsError}).</p>}
          </main>
        </div>
      </>
    );
  }

  return (
    <div className="app-shell">
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
      {player.audioSuppressed && (
        <div className="audio-suppressed-banner" role="status">
          Playback hasn't started. On iOS this usually means Focus or Do Not
          Disturb is suppressing audio — try toggling it off in Control Center.
          If that's not it, try playing again.
        </div>
      )}
      <AppHeader
        userEmail={user.email}
        userInitials={initialsFromEmail(user.email)}
        projectTitle={player.state.title || null}
        stemCount={player.state.stems.length}
        duration={player.state.duration}
        annotationsOpen={drawerOpen}
        hasProject={player.state.stems.length > 0}
        canRename={player.state.stems.length > 0}
        isWide={isWide}
        appVersion={appInfo?.version ?? null}
        appEnv={appInfo?.env ?? null}
        downloading={downloading}
        debugInfo={player.debugInfo}
        onOpenPicker={openPicker}
        onToggleAnnotations={toggleDrawer}
        onSignOut={onLogout}
        onReportBug={() => openBugReport()}
        onOpenTokens={() => setTokensOpen(true)}
        onDownloadAll={onDownloadAll}
        onRenameProject={(name) => {
          // In draft mode there's no server project yet — just update the
          // player title. The new title becomes the default upload name on
          // promote.
          if (activeProjectId) {
            void renameProject(activeProjectId, name);
          } else {
            player.setTitle(name.trim());
          }
        }}
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
        annotationCreateMode={annotationCreateMode}
        canCreateAnnotations={activeProjectId !== null}
        markersVisible={markersVisible}
        railCollapsed={railCollapsed}
        showRailToggle={true}
        isWide={isWide}
        onSeek={player.seek}
        onTogglePlay={() => void player.togglePlay()}
        onToggleLoopEnabled={player.toggleLoopEnabled}
        onToggleWaveformNormalization={player.toggleWaveformNormalization}
        onToggleAnnotationCreate={handleAddButton}
        onToggleMarkersVisible={() => setMarkersVisible((v) => !v)}
        onSetMasterVolume={player.setMasterVolume}
        onToggleRailCollapsed={() => setRailCollapsed((v) => !v)}
        viewport={viewport}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onShare={handleShareSnapshot}
      />
      {activeProjectId === null && draftFiles.length > 0 && (
        <div className="draft-banner" role="status">
          <span className="draft-banner-label">
            Local draft — only on this device.
          </span>
          {showUploadButton && (
            <button
              type="button"
              className="draft-banner-save"
              onClick={() => setUploadOpen(true)}
            >
              Save to your band
            </button>
          )}
        </div>
      )}
      <div className="app-body">
        <ErrorBoundary onReportBug={openBugReport}>
          <Player
            player={player}
            annotations={annotations}
            userColorMap={userColorMap}
            markersVisible={markersVisible}
            annotationCreateMode={annotationCreateMode}
            onToggleAnnotationCreate={() => setAnnotationCreateMode((v) => !v)}
            onAnnotationCreated={handleAnnotationCreated}
            onAnnotationSelected={handleAnnotationSelected}
            onLoopAnnotation={handleLoopAnnotation}
            pendingDraft={pendingDraft}
            hoveredAnnotationId={hoveredAnnotationId}
            onHoverAnnotation={setHoveredAnnotationId}
            railCollapsed={railCollapsed}
            canMutate={player.state.stems.length > 0}
            onOpenPicker={openPicker}
            onRenameStem={(id, name) => void renameStem(id, name)}
            onDeleteStem={(id) => void deleteStem(id)}
            viewport={viewport}
          />
        </ErrorBoundary>
        {showZoomHint && player.state.stems.length > 0 && (
          <div className="zoom-hint" role="status" onClick={dismissZoomHint}>
            <span>Hold <kbd>⌥</kbd> and scroll to zoom in. Press <kbd>?</kbd> for shortcuts.</span>
            <button
              type="button"
              className="zoom-hint-close"
              onClick={dismissZoomHint}
              aria-label="Dismiss hint"
            >
              ×
            </button>
          </div>
        )}
        {(() => {
          const active = annotations.find((a) => a.id === activeCommentId) ?? null;
          const isNarrow = railCollapsed;
          const color =
            (active && userColorMap.get(active.user_id)) ?? '#c17446';
          return (
            <>
              <CommentsDrawer
                key={activeProjectId ?? 'none'}
                open={drawerOpen}
                isNarrow={isNarrow}
                selfUserId={user.id}
                canEdit={activeProjectId !== null}
                annotations={annotations}
                userColorMap={userColorMap}
                activeId={activeCommentId}
                emphasizedId={emphasizedCommentId}
                pendingDraft={pendingDraft}
                onClose={closeDrawer}
                onSelect={handleAnnotationSelected}
                onCreate={(body) => void handleCreateFromDraft(body)}
                onDraftCancel={() => setPendingDraft(null)}
                onToggleStar={(a) => void handleToggleStar(a)}
                onSaveEdit={(a, body) => void handleSaveEdit(a, body)}
                onDelete={(a) => void handleDelete(a)}
                onCopyLink={handleCopyCommentLink}
              />
              {!drawerOpen && (
                <CommentsFab
                  count={annotations.length}
                  starredCount={annotations.filter((a) => a.starred).length}
                  onClick={openDrawer}
                />
              )}
              {active && popoverAnchor && !isNarrow &&
                createPortal(
                  <CommentPopover
                    annotation={active}
                    color={color}
                    anchorLeftPx={popoverAnchor.left}
                    anchorTopPx={popoverAnchor.top}
                    canEdit={activeProjectId !== null}
                    isOwn={active.user_id === user.id}
                    drawerOpen={drawerOpen}
                    emphasize={emphasizedCommentId === active.id}
                    onLoopRegion={() => handleLoopAnnotation(active)}
                    onToggleStar={() => void handleToggleStar(active)}
                    onSaveEdit={(body) => void handleSaveEdit(active, body)}
                    onDelete={() => void handleDelete(active)}
                    onCopyLink={() => handleCopyCommentLink(active)}
                    onClose={() => { setActiveCommentId(null); setPopoverAnchor(null); }}
                  />,
                  document.body,
                )}
              {active && isNarrow &&
                createPortal(
                  (() => {
                    const idx = annotations.findIndex((a) => a.id === active.id);
                    const navTo = (newIdx: number) => {
                      const a = annotations[newIdx];
                      if (a) handleAnnotationSelected(a);
                    };
                    return (
                      <CommentBottomSheet
                        annotation={active}
                        color={color}
                        canEdit={activeProjectId !== null}
                        isOwn={active.user_id === user.id}
                        index={idx}
                        total={annotations.length}
                        onPrev={() => navTo(idx - 1)}
                        onNext={() => navTo(idx + 1)}
                        onLoopRegion={() => handleLoopAnnotation(active)}
                        onToggleStar={() => void handleToggleStar(active)}
                        onSaveEdit={(body) => void handleSaveEdit(active, body)}
                        onDelete={() => void handleDelete(active)}
                        onClose={() => { setActiveCommentId(null); setPopoverAnchor(null); }}
                      />
                    );
                  })(),
                  document.body,
                )}
            </>
          );
        })()}
      </div>
      <FilePicker
        open={pickerOpen}
        loading={projectsLoading}
        loadError={loadError}
        projects={projects}
        activeProjectId={activeProjectId}
        showUpload={showUploadButton}
        onClose={closePicker}
        onSelect={(id) => {
          void selectProject(id);
          closePicker();
        }}
        onLoadFolder={(files, folderName) => {
          loadFolder(files, folderName);
          closePicker();
        }}
        onRetry={() => {
          setProjectsLoading(true);
          void refreshProjects().catch(() => {});
        }}
        onRenameProject={(id, name) => {
          void renameProject(id, name);
        }}
        onDeleteProject={(id) => {
          void deleteProject(id);
        }}
        trash={trash}
        trashError={trashError}
        onLoadTrash={() => {
          void loadTrash();
        }}
        onRestoreProject={(id) => {
          void restoreProject(id);
        }}
        onRestoreStem={(id) => {
          void restoreStem(id);
        }}
      />
      {showUploadButton && activeBandId && (
        <UploadDrawer
          bandId={activeBandId}
          open={uploadOpen}
          prefilledFiles={draftFiles}
          prefilledName={
            draftFiles.length > 0 ? player.state.title || null : null
          }
          onClose={() => setUploadOpen(false)}
          onUploaded={(id) => void handleUploaded(id)}
        />
      )}
      <BugReportDrawer
        open={bugReportOpen}
        isNarrow={railCollapsed}
        reporterEmail={user.email}
        appVersion={appInfo?.version ?? null}
        prefill={bugReportPrefill}
        pageContext={{
          activeBandId,
          activeProjectId,
          projectTitle: player.state.title ?? null,
          stemCount: player.state.stems.length,
          isPlaying: player.state.isPlaying,
          currentTime: player.currentTime,
          duration: player.state.duration,
          loop: player.state.loop ?? null,
          drawerOpen,
          pickerOpen,
        }}
        onClose={closeBugReport}
      />
      <ShortcutsOverlay
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
      <ShareDialog
        open={shareDialog !== null}
        state={shareDialog?.state ?? { projectId: '' }}
        focusedAnnotation={shareDialog?.focusedAnnotation ?? null}
        onClose={() => setShareDialog(null)}
      />
      <TokensDrawer open={tokensOpen} onClose={() => setTokensOpen(false)} />
    </div>
  );
}
