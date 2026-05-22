import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoginScreen } from './auth/LoginScreen';
import { useBands } from './auth/useBands';
import { useSession } from './auth/useSession';
import { consumeReturnPath } from './lib/public-return';
import { buildDocumentTitle } from './lib/document-title';
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
import { Plus } from 'lucide-react';
import { AppHeader } from './components/AppHeader';
import { PresenceProvider, usePresentIn } from './hooks/usePresenceConnection';
import { AppToolbar } from './components/AppToolbar';
import {
  BugReportDrawer,
  type BugReportPrefill,
} from './components/BugReportDrawer';
import { CreateGroupDialog } from './components/CreateGroupDialog';
import { GroupsDrawer } from './components/GroupsDrawer';
import { TokensDrawer } from './components/TokensDrawer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProjectPicker } from './components/ProjectPicker';
import { Player } from './components/Player';
import { SectionHintChip } from './components/SectionHintChip';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { ShareDialog } from './components/ShareDialog';
import { UploadDrawer } from './components/UploadDrawer';
import {
  listAnnotations,
  createAnnotation,
  patchAnnotation,
  deleteAnnotation,
  addReaction,
  createReply as createReplyApi,
  deleteReply as deleteReplyApi,
  listReplies,
  patchReply as patchReplyApi,
  removeReaction,
} from './data/annotations-repo';
import {
  listSections,
  createSection,
  patchSection,
  deleteSection,
} from './data/sections-repo';
import { END_SECTION_LABEL } from './lib/section-end';
import { findRunningSection } from './lib/running-section';
import {
  listSongs,
  listSongUsage,
  renameSong,
  mergeSong,
  type SongUsageRow,
} from './data/songs-repo';
import { SectionPopover, type SectionSubmit } from './components/SectionPopover';
import { HttpProjectsRepo, type ProjectsRepo } from './data/projects-repo';
import type { Project, StemSource, TrashList } from './data/types';
import { decodePeaks } from './lib/peaks';
import { useAppVersion } from './hooks/useAppVersion';
import { useIsMobile } from './hooks/useIsMobile';
import { useKeyboard } from './hooks/useKeyboard';
import { usePlayer } from './hooks/usePlayer';
import { useViewport } from './hooks/useViewport';
import { buildUserColorMap, SELF_ANNOTATION_COLOR } from './lib/colors';
import { downloadStemsAsZip } from './lib/download';
import type {
  Annotation,
  AnnotationReply,
  Reaction,
  ReactionTarget,
  Section,
  Song,
  User,
} from '../shared/types';

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
      document.body.classList.add('env-non-prod');
      document.body.dataset.env = env;
    } else {
      document.body.classList.remove('env-non-prod');
      delete document.body.dataset.env;
    }
    // PaperstemApp owns the title once mounted (it knows the open project);
    // here we only cover the pre-app states (loading, login screen).
    if (!user) document.title = buildDocumentTitle(env);
  }, [appInfo?.env, user]);

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

  // Anonymous viewers of /p/<token> who hit "Sign in" land here after the
  // magic-link round trip. PublicProjectView stashed the path in
  // sessionStorage before redirecting; if we now have a session, bounce
  // them back to /p/<token>. The public view will then re-check
  // membership and forward to /#p=<id> if applicable.
  // consumeReturnPath() also enforces the /p/ prefix so a corrupted
  // sessionStorage value can't trigger an open redirect elsewhere.
  useEffect(() => {
    if (loading || !user) return;
    const pending = consumeReturnPath();
    if (pending) window.location.assign(pending);
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
  const isMobile = useIsMobile();
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

  const [showSectionHint, setShowSectionHint] = useState<boolean>(() => {
    try {
      return localStorage.getItem('paperstem.hints.sections.seen') !== '1';
    } catch {
      return false;
    }
  });

  const dismissSectionHint = useCallback(() => {
    setShowSectionHint(false);
    try {
      localStorage.setItem('paperstem.hints.sections.seen', '1');
    } catch {
      // ignore
    }
  }, []);

  const {
    bands,
    loading: bandsLoading,
    error: bandsError,
    refresh: refreshBands,
    dropLocally: dropBandLocally,
    addLocally: addBandLocally,
    updateLocally: updateBandLocally,
  } = useBands(true);
  // Namespaced by user.id so two users sharing a browser don't clobber each
  // other's last-chosen group.
  const currentGroupStorageKey = `paperstem.currentGroupId.${user.id}`;
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(currentGroupStorageKey);
    } catch {
      return null;
    }
  });
  // Keep the stored id valid: if the user lost membership or never had one,
  // fall back to the first band and persist that choice.
  useEffect(() => {
    if (!bands.length) return;
    const valid =
      currentGroupId !== null && bands.some((b) => b.id === currentGroupId);
    if (!valid) {
      const next = bands[0]!.id;
      setCurrentGroupId(next);
      try {
        localStorage.setItem(currentGroupStorageKey, next);
      } catch {
        // ignore
      }
    }
  }, [bands, currentGroupId, currentGroupStorageKey]);
  const activeBand = useMemo(
    () => bands.find((b) => b.id === currentGroupId) ?? bands[0] ?? null,
    [bands, currentGroupId],
  );
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
  // around so the "Save to {bandName}" banner button can hand them to
  // UploadDrawer for promotion.
  const [draftFiles, setDraftFiles] = useState<File[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [replies, setReplies] = useState<Map<string, AnnotationReply[]>>(
    () => new Map(),
  );
  const [sections, setSections] = useState<Section[]>([]);
  // Pulsed true for one animation-length window right after a project's
  // comments/sections commit, so Player can fade those markers in on load
  // without re-triggering on the lane's hover-expand or the markers-visibility
  // toggle (both of which remount the elements). Ref-managed timer so a fast
  // project switch resets the window rather than stacking timers.
  const [contentEntering, setContentEntering] = useState(false);
  const contentEnterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flagContentEntering = useCallback(() => {
    setContentEntering(true);
    if (contentEnterTimer.current) clearTimeout(contentEnterTimer.current);
    contentEnterTimer.current = setTimeout(() => setContentEntering(false), 260);
  }, []);
  useEffect(
    () => () => {
      if (contentEnterTimer.current) clearTimeout(contentEnterTimer.current);
    },
    [],
  );
  const [songs, setSongs] = useState<Song[]>([]);
  const [songUsage, setSongUsage] = useState<SongUsageRow[]>([]);
  const [sectionCreateMode, setSectionCreateMode] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  // The popover state covers both "create at clicked position" and
  // "edit existing section". `section: null` means create.
  const [sectionPopover, setSectionPopover] = useState<{
    section: Section | null;
    startMs: number;
    anchorLeft: number;
    anchorTop: number;
  } | null>(null);
  // Project filter driven by the ProjectPicker chip-rail.
  const [filterSongId, setFilterSongId] = useState<string | null>(null);
  // Transient undo toast for destructive song operations (rename across N
  // practices, merge). Auto-clears after 6 seconds; the timer ref lets a
  // second rename within the window cancel its predecessor's dismiss so
  // the newer toast keeps its full 6 seconds and the older one's
  // `previousName` closure isn't accidentally invoked against
  // already-updated state.
  const [songToast, setSongToast] = useState<{
    message: string;
    onUndo: () => void;
  } | null>(null);
  const songToastTimerRef = useRef<number | null>(null);
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
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  // Share dialog state. Non-null while the dialog is open; the snapshot is
  // captured at open time so toggling state inside the dialog can't be
  // influenced by ongoing playback or zoom changes underneath.
  const [shareDialog, setShareDialog] = useState<{
    state: ShareState;
    focusedAnnotation: Annotation | null;
  } | null>(null);

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
  const pendingReactionsRef = useRef<Set<string>>(new Set());

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
    // Toggling the comments sidebar dismisses any open comment popover —
    // the popover is part of the "comment focus" the toggle is acting on.
    setActiveCommentId(null);
    setPopoverAnchor(null);
    if (drawerOpen) closeDrawer();
    else openDrawer();
  }, [drawerOpen, openDrawer, closeDrawer]);

  const closePopovers = useCallback(() => {
    setActiveCommentId(null);
    setPopoverAnchor(null);
    setSectionPopover(null);
  }, []);

  // Tear down all project-scoped UI state. Used when crossing a project
  // boundary in a context where no new project is being loaded immediately
  // (group switch, leave group). loadProject() and deleteProject() have
  // their own resets tuned to their own flows; this helper is for the
  // "go back to no-project" transitions.
  const resetProjectScopedUiState = useCallback(() => {
    player.clear();
    setActiveProjectId(null);
    setDraftFiles([]);
    setAnnotations([]);
    setReplies(() => new Map());
    setSections([]);
    setActiveSectionId(null);
    setSectionPopover(null);
    setSectionCreateMode(false);
    setAnnotationCreateMode(false);
    setActiveCommentId(null);
    setPopoverAnchor(null);
    setPendingDraft(null);
    setTrash(null);
    setTrashError(null);
    setLoadError(null);
    setUploadOpen(false);
    viewport.fitToWindow();
  }, [player, viewport]);

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

  // Keep `document.title` in step with the open project. The SPA only swaps
  // content (and the URL hash) on navigation, so without this the tab title
  // and screen-reader page title stay stuck on the brand name.
  // `player.state.title` is the em-dash placeholder when no project is loaded;
  // treat that as "no project" so the tab title is the bare brand, not "— —".
  const documentProjectTitle =
    player.state.title && player.state.title !== '—' ? player.state.title : null;
  useEffect(() => {
    document.title = buildDocumentTitle(appInfo?.env, documentProjectTitle);
  }, [appInfo?.env, documentProjectTitle]);

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
    // Any full-screen blocking overlay besides the picker. While one is open,
    // the hook suppresses global shortcuts so keys don't stack dialogs (#222).
    overlayOpen:
      shortcutsOpen ||
      shareDialog !== null ||
      uploadOpen ||
      bugReportOpen ||
      tokensOpen ||
      groupSettingsOpen ||
      createGroupOpen,
    drawerOpen,
    popoverOpen: activeCommentId !== null || sectionPopover !== null,
    annotationCreateMode,
    sectionCreateMode,
    viewport,
    onTogglePicker: () => (pickerOpen ? closePicker() : openPicker()),
    onClosePicker: closePicker,
    onCloseDrawer: closeDrawer,
    onClosePopover: closePopovers,
    onCancelCreate: () => {
      setAnnotationCreateMode(false);
      setSectionCreateMode(false);
      setPendingDraft(null);
    },
    onToggleShortcuts: () => setShortcutsOpen((v) => !v),
    onAddCommentAtPlayhead: () => {
      if (!activeProjectId) return;
      const startMs = Math.round(player.currentTime * 1000);
      handleAnnotationCreated(startMs, null);
    },
    onAddSectionAtPlayhead: () => {
      if (!activeProjectId) return;
      const startMs = Math.max(0, Math.round(player.currentTime * 1000));
      openSectionPopoverAtPlayhead(startMs);
    },
    onAddEndMarkerAtPlayhead: () => {
      if (!activeProjectId) return;
      const startMs = Math.max(0, Math.round(player.currentTime * 1000));
      const projectId = activeProjectId;
      // Shift+M drops a section labeled "—" at the playhead with no
      // popover prompt. The previous section's pill auto-truncates at
      // this point via the existing next-start render rule.
      void (async () => {
        try {
          const created = await createSection(projectId, {
            start_ms: startMs,
            label: END_SECTION_LABEL,
          });
          setSections((cur) =>
            [...cur, created].sort((a, b) => a.start_ms - b.start_ms),
          );
          setActiveSectionId(created.id);
        } catch (err) {
          console.error('end marker create failed', err);
        }
      })();
    },
  });

  const userColorMap = useMemo(
    () => buildUserColorMap(annotations.map((a) => a.user_id), user.id),
    [annotations, user.id],
  );

  const selfDisplayName = user.display_name ?? user.email;
  const selfColor = userColorMap.get(user.id) ?? SELF_ANNOTATION_COLOR;

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
    activeBand !== null && activeBand.role === 'owner';

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
        setReplies(() => new Map());
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
        setReplies(() => new Map());
        setSections([]);
        setActiveSectionId(null);
        setSectionPopover(null);
        setSectionCreateMode(false);
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
          durationMs: s.durationMs,
        }));
        void player.load({
          projectId: detail.id,
          title: detail.title,
          folderId: detail.folderId,
          sources,
        });
        // Fetch comments + sections concurrently and commit both once they've
        // settled, so their markers appear in the same frame rather than
        // staggering in one after the other.
        const [annoRes, sectionRes] = await Promise.allSettled([
          listAnnotations(id),
          listSections(id),
        ]);
        if (annoRes.status === 'fulfilled') setAnnotations(annoRes.value);
        else console.error('Failed to load annotations:', annoRes.reason);
        if (sectionRes.status === 'fulfilled') setSections(sectionRes.value);
        else console.error('Failed to load sections:', sectionRes.reason);
        // Open the entrance-fade window in the same commit the markers mount.
        flagContentEntering();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(msg);
      }
    },
    [repo, player, viewport, flagContentEntering],
  );

  // Load the band's song catalog + usage map once per active band. These
  // power the ProjectPicker chip-rail, the section popover's autocomplete,
  // and the "shared name" chain glyph in the section lane.
  const refreshBandSongs = useCallback(async () => {
    if (!activeBandId) {
      setSongs([]);
      setSongUsage([]);
      return;
    }
    try {
      const [songList, usage] = await Promise.all([
        listSongs(activeBandId),
        listSongUsage(activeBandId),
      ]);
      setSongs(songList);
      setSongUsage(usage);
    } catch (err) {
      console.error('Failed to load band songs:', err);
    }
  }, [activeBandId]);

  useEffect(() => {
    void refreshBandSongs();
  }, [refreshBandSongs]);

  // Clear the chip-rail filter when the active band changes — a filter
  // set in Band A doesn't match any song in Band B, so leaving it set
  // would render an empty project list with no obvious cause.
  useEffect(() => {
    setFilterSongId(null);
  }, [activeBandId]);

  // use_count from the songs endpoint is by project. The section-lane chain
  // glyph wants the same number, so just project it from `songs`.
  const songUseCounts = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const s of songs) m.set(s.id, s.use_count);
    return m;
  }, [songs]);

  const openSectionPopoverAtPlayhead = useCallback(
    (startMs: number) => {
      // Anchor near where the playhead is rendered. Falling back to the
      // viewport center is fine if we can't measure — the popover is
      // fixed-positioned with transform centering.
      let anchorLeft = window.innerWidth / 2;
      let anchorTop = window.innerHeight / 2;
      const playhead = document.querySelector('.playhead') as HTMLElement | null;
      if (playhead) {
        const r = playhead.getBoundingClientRect();
        anchorLeft = r.left + r.width / 2;
        anchorTop = r.top + 40;
      }
      setSectionPopover({ section: null, startMs, anchorLeft, anchorTop });
      // Clear both create-modes — invoking the popover via the M shortcut
      // from inside comment-create mode would otherwise leave the
      // annotation-create overlay live behind the popover, intercepting
      // clicks meant for the popover's controls.
      setSectionCreateMode(false);
      setAnnotationCreateMode(false);
      setPendingDraft(null);
    },
    [],
  );

  const handleSectionSelected = useCallback((section: Section) => {
    setActiveSectionId(section.id);
    queueMicrotask(() => {
      const el = document.querySelector(
        `[data-section-id="${section.id}"]`,
      ) as HTMLElement | null;
      if (!el) {
        setSectionPopover({
          section,
          startMs: section.start_ms,
          anchorLeft: window.innerWidth / 2,
          anchorTop: window.innerHeight / 2,
        });
        return;
      }
      const r = el.getBoundingClientRect();
      setSectionPopover({
        section,
        startMs: section.start_ms,
        anchorLeft: r.left + r.width / 2,
        anchorTop: r.bottom,
      });
    });
  }, []);

  const handleSectionCreatedAtClick = useCallback(
    (startMs: number, clientX: number, clientY: number) => {
      setSectionPopover({
        section: null,
        startMs,
        anchorLeft: clientX,
        anchorTop: clientY,
      });
      setSectionCreateMode(false);
    },
    [],
  );

  // Rename the song the section currently references. Three paths:
  //   - 409 collision: a song with this normalized name already exists
  //     in the catalog → offer a merge prompt; on accept, repoint every
  //     section pointing at the loser, drop the loser row, and refresh
  //     local state in-place using the merge response.
  //   - >1 practice rename: show an undo toast with a single-shot
  //     dismiss timer (cancelled if a second rename arrives within 6s,
  //     so the newer toast keeps its full window).
  //   - plain rename: silent; the popover close is the only signal.
  //
  // All paths update `songs` / `songUsage` / `sections` in place from
  // the server's response — never via `listSections(activeProjectId)`,
  // which would race a project switch and write old-project data into
  // the new-project's state.
  const renameSongUnderSection = useCallback(
    async (songId: string, newName: string) => {
      const before = songs.find((s) => s.id === songId);
      if (!before) return;
      try {
        const result = await renameSong(songId, newName);
        if (result.kind === 'conflict') {
          const ok = window.confirm(
            `A song named "${result.existing_song_name}" already exists. Merge "${before.name}" into it?`,
          );
          if (!ok) return;
          const winner = await mergeSong(songId, result.existing_song_id);
          // Loser is gone; the winner row gained the loser's sections in
          // its use_count. Replace winner in place and drop loser; remap
          // sections so the chapter lane and the chip-rail re-render
          // without an extra round-trip.
          const loserId = songId;
          setSongs((prev) =>
            prev
              .filter((s) => s.id !== loserId)
              .map((s) => (s.id === winner.id ? winner : s)),
          );
          setSongUsage((prev) => {
            const out: SongUsageRow[] = [];
            const seen = new Set<string>();
            for (const row of prev) {
              const sid = row.song_id === loserId ? winner.id : row.song_id;
              const key = `${row.project_id}::${sid}`;
              if (seen.has(key)) continue;
              seen.add(key);
              out.push({ project_id: row.project_id, song_id: sid });
            }
            return out;
          });
          setSections((prev) =>
            prev.map((s) =>
              s.song_id === loserId
                ? { ...s, song_id: winner.id, song_name: winner.name }
                : s,
            ),
          );
          return;
        }
        // Plain rename: in-place update of songs + every section that
        // referenced the renamed song. No listSections refetch — that
        // path used to race a project switch and corrupt state.
        const renamed = result.song;
        setSongs((prev) =>
          prev.map((s) => (s.id === renamed.id ? renamed : s)),
        );
        setSections((prev) =>
          prev.map((s) =>
            s.song_id === renamed.id ? { ...s, song_name: renamed.name } : s,
          ),
        );
        if (before.use_count > 1) {
          const previousName = before.name;
          if (songToastTimerRef.current !== null) {
            window.clearTimeout(songToastTimerRef.current);
          }
          setSongToast({
            message: `Renamed in ${before.use_count} practices.`,
            onUndo: () => {
              void (async () => {
                try {
                  const undone = await renameSong(songId, previousName);
                  if (undone.kind === 'ok') {
                    const restored = undone.song;
                    setSongs((prev) =>
                      prev.map((s) =>
                        s.id === restored.id ? restored : s,
                      ),
                    );
                    setSections((prev) =>
                      prev.map((s) =>
                        s.song_id === restored.id
                          ? { ...s, song_name: restored.name }
                          : s,
                      ),
                    );
                  }
                  setSongToast(null);
                } catch {
                  /* ignore */
                }
              })();
            },
          });
          songToastTimerRef.current = window.setTimeout(() => {
            songToastTimerRef.current = null;
            setSongToast((t) => (t ? null : t));
          }, 6000);
        }
      } catch (err) {
        console.error('song rename failed', err);
      }
    },
    [songs],
  );

  const handleSectionSubmit = useCallback(
    async (payload: SectionSubmit) => {
      const popover = sectionPopover;
      if (!popover || !activeProjectId) return;
      try {
        // Rename branch: the section already exists and the user typed a
        // name that's neither an exact match nor identical to the
        // current song's name. The whole "rename one renames all"
        // semantic happens here; the rest of the popover's branches
        // edit the section's reference only.
        if (payload.kind === 'song_rename') {
          await renameSongUnderSection(payload.song_id, payload.new_name);
          return;
        }
        if (popover.section === null) {
          // Create new section. Map the popover payload to the repo input.
          const input =
            payload.kind === 'song_id'
              ? { start_ms: popover.startMs, song_id: payload.song_id }
              : payload.kind === 'song_name'
                ? { start_ms: popover.startMs, song_name: payload.song_name }
                : payload.kind === 'label'
                  ? { start_ms: popover.startMs, label: payload.label }
                  : { start_ms: popover.startMs };
          const created = await createSection(activeProjectId, input);
          setSections((cur) => [...cur, created].sort((a, b) => a.start_ms - b.start_ms));
          setActiveSectionId(created.id);
        } else {
          const id = popover.section.id;
          const input =
            payload.kind === 'song_id'
              ? { song_id: payload.song_id }
              : payload.kind === 'song_name'
                ? { song_name: payload.song_name }
                : payload.kind === 'label'
                  ? { label: payload.label }
                  : { clear_name: true };
          const updated = await patchSection(id, input);
          setSections((cur) => cur.map((s) => (s.id === id ? updated : s)));
        }
        await refreshBandSongs();
      } catch (err) {
        console.error('section submit failed', err);
      } finally {
        setSectionPopover(null);
      }
    },
    [sectionPopover, activeProjectId, refreshBandSongs, renameSongUnderSection],
  );

  const handleSectionPatchStart = useCallback(
    async (id: string, input: { start_ms: number }) => {
      setSections((cur) =>
        cur
          .map((s) => (s.id === id ? { ...s, start_ms: input.start_ms } : s))
          .sort((a, b) => a.start_ms - b.start_ms),
      );
      try {
        const updated = await patchSection(id, input);
        setSections((cur) =>
          cur.map((s) => (s.id === id ? updated : s)).sort((a, b) => a.start_ms - b.start_ms),
        );
      } catch (err) {
        console.error('section patch failed', err);
        if (activeProjectId) {
          try {
            const list = await listSections(activeProjectId);
            setSections(list);
          } catch {
            /* ignore — the user will see stale data until next reload */
          }
        }
      }
    },
    [activeProjectId],
  );

  const handleSectionDelete = useCallback(async () => {
    const popover = sectionPopover;
    if (!popover?.section) return;
    const id = popover.section.id;
    setSectionPopover(null);
    setSections((cur) => cur.filter((s) => s.id !== id));
    if (activeSectionId === id) setActiveSectionId(null);
    try {
      await deleteSection(id);
      await refreshBandSongs();
    } catch (err) {
      console.error('section delete failed', err);
      // Best-effort recovery: re-fetch sections for the current project.
      if (activeProjectId) {
        try {
          const list = await listSections(activeProjectId);
          setSections(list);
        } catch {
          /* ignore */
        }
      }
    }
  }, [sectionPopover, activeSectionId, activeProjectId, refreshBandSongs]);


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
      // Mutex with section-create mode: only one create-mode banner /
      // overlay should ever be live at once. Unconditional false is
      // safe: if annotation mode is being turned off, the section was
      // already off (assuming the invariant holds elsewhere); if it's
      // being turned on, we drop any active section-create state.
      setSectionCreateMode(false);
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

  const handleAnnotationPatchRange = useCallback(
    async (id: string, input: { start_ms: number; end_ms: number | null }) => {
      setAnnotations((cur) =>
        cur.map((a) => (a.id === id ? { ...a, ...input } : a)),
      );
      try {
        const updated = await patchAnnotation(id, input);
        setAnnotations((cur) => cur.map((a) => (a.id === id ? updated : a)));
      } catch (err) {
        console.error('annotation patch failed', err);
        if (activeProjectId) {
          try {
            const list = await listAnnotations(activeProjectId);
            setAnnotations(list);
          } catch {
            /* ignore */
          }
        }
      }
    },
    [activeProjectId],
  );

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

  const loadReplies = useCallback(async (annotationId: string): Promise<void> => {
    if (replies.has(annotationId)) return;
    // Let the caller observe failure so it can surface an error and offer a
    // retry. App.tsx itself doesn't need a toast here — ReplyThread owns the
    // per-thread error UI.
    const fetched = await listReplies(annotationId);
    setReplies((m) => {
      const next = new Map(m);
      next.set(annotationId, fetched);
      return next;
    });
  }, [replies]);

  const createReply = useCallback(async (
    annotationId: string,
    body: string,
  ): Promise<void> => {
    const reply = await createReplyApi(annotationId, body);
    setReplies((m) => {
      const next = new Map(m);
      next.set(annotationId, [...(next.get(annotationId) ?? []), reply]);
      return next;
    });
    setAnnotations((list) =>
      list.map((a) =>
        a.id === annotationId ? { ...a, reply_count: a.reply_count + 1 } : a,
      ),
    );
  }, []);

  const editReply = useCallback(async (replyId: string, body: string): Promise<void> => {
    const updated = await patchReplyApi(replyId, body);
    setReplies((m) => {
      const next = new Map(m);
      const arr = next.get(updated.annotation_id);
      if (arr) {
        next.set(
          updated.annotation_id,
          arr.map((r) => (r.id === replyId ? updated : r)),
        );
      }
      return next;
    });
  }, []);

  const deleteReply = useCallback(async (annotationId: string, replyId: string): Promise<void> => {
    await deleteReplyApi(replyId);
    setReplies((m) => {
      const next = new Map(m);
      const arr = next.get(annotationId);
      if (arr) next.set(annotationId, arr.filter((r) => r.id !== replyId));
      return next;
    });
    setAnnotations((list) =>
      list.map((a) =>
        a.id === annotationId
          ? { ...a, reply_count: Math.max(0, a.reply_count - 1) }
          : a,
      ),
    );
  }, []);

  function applyReactionDelta(
    reactions: Reaction[],
    emoji: string,
    selfUserId: string,
    delta: 1 | -1,
  ): Reaction[] {
    const existing = reactions.find((r) => r.emoji === emoji);
    if (delta === 1) {
      if (existing && existing.reacted_by_self) return reactions;
      if (existing) {
        return reactions.map((r) =>
          r.emoji === emoji
            ? {
                ...r,
                count: r.count + 1,
                user_ids: [...r.user_ids, selfUserId],
                reacted_by_self: true,
              }
            : r,
        );
      }
      return [
        ...reactions,
        {
          emoji,
          count: 1,
          user_ids: [selfUserId],
          reacted_by_self: true,
        },
      ];
    }
    if (!existing || !existing.reacted_by_self) return reactions;
    if (existing.count === 1) return reactions.filter((r) => r.emoji !== emoji);
    return reactions.map((r) =>
      r.emoji === emoji
        ? {
            ...r,
            count: r.count - 1,
            user_ids: r.user_ids.filter((u) => u !== selfUserId),
            reacted_by_self: false,
          }
        : r,
    );
  }

  async function toggleReaction(
    target: ReactionTarget,
    emoji: string,
  ): Promise<void> {
    const key = `${target.kind}:${target.id}:${emoji}`;
    if (pendingReactionsRef.current.has(key)) return;
    pendingReactionsRef.current.add(key);

    const selfId = user.id;

    function applyReactionToState(d: 1 | -1): void {
      if (target.kind === 'annotation') {
        setAnnotations((list) =>
          list.map((a) =>
            a.id === target.id
              ? { ...a, reactions: applyReactionDelta(a.reactions, emoji, selfId, d) }
              : a,
          ),
        );
      } else {
        setReplies((m) => {
          const next = new Map(m);
          for (const [annId, arr] of next.entries()) {
            if (arr.some((r) => r.id === target.id)) {
              next.set(
                annId,
                arr.map((r) =>
                  r.id === target.id
                    ? { ...r, reactions: applyReactionDelta(r.reactions, emoji, selfId, d) }
                    : r,
                ),
              );
              break;
            }
          }
          return next;
        });
      }
    }

    let isOn = false;
    if (target.kind === 'annotation') {
      const a = annotations.find((x) => x.id === target.id);
      isOn = !!a?.reactions.find(
        (r) => r.emoji === emoji && r.reacted_by_self,
      );
    } else {
      for (const arr of replies.values()) {
        const r = arr.find((x) => x.id === target.id);
        if (r) {
          isOn = !!r.reactions.find(
            (x) => x.emoji === emoji && x.reacted_by_self,
          );
          break;
        }
      }
    }
    const delta: 1 | -1 = isOn ? -1 : 1;

    applyReactionToState(delta);

    try {
      if (delta === 1) await addReaction(target, emoji);
      else await removeReaction(target, emoji);
    } catch (err) {
      const roll: 1 | -1 = delta === 1 ? -1 : 1;
      applyReactionToState(roll);
      console.error('toggleReaction failed', err);
    } finally {
      pendingReactionsRef.current.delete(key);
    }
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
            <p>
              You're not in any groups yet. Create one to share projects, or
              ask a group's owner to add you.
            </p>
            <button
              type="button"
              className="empty-state-cta"
              onClick={() => setCreateGroupOpen(true)}
            >
              <Plus size={14} strokeWidth={2} aria-hidden="true" />
              New group
            </button>
            {bandsError && <p className="error">Could not load groups ({bandsError}).</p>}
          </main>
        </div>
        <CreateGroupDialog
          open={createGroupOpen}
          onClose={() => setCreateGroupOpen(false)}
          onCreated={(group) => {
            // Add the band to local state first so the empty-state branch
            // releases immediately; persist the choice; then refresh so
            // the server-side list catches up.
            addBandLocally(group);
            setCurrentGroupId(group.id);
            try {
              localStorage.setItem(currentGroupStorageKey, group.id);
            } catch {
              // ignore
            }
            setCreateGroupOpen(false);
            refreshBands();
          }}
        />
      </>
    );
  }

  return (
    <PresenceProvider>
    <PresenceTracker projectId={activeProjectId} />
    <div className="app-shell">
      {/* Single page heading that tracks the open project, so screen-reader
          heading navigation reflects the main content (the brand in the header
          is a styled <span>, not a heading). */}
      <h1 className="sr-only">{documentProjectTitle ?? 'Paperstem'}</h1>
      {/* Politely announces project navigation for screen readers — the SPA
          otherwise changes content with no perceivable route transition. */}
      <div className="sr-only" role="status" aria-live="polite">
        {documentProjectTitle ? `Viewing project: ${documentProjectTitle}` : ''}
      </div>
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
          Not hearing anything? iOS Focus or Do Not Disturb may be muting audio.
        </div>
      )}
      <AppHeader
        userEmail={user.email}
        userInitials={initialsFromEmail(user.email)}
        currentUserId={user.id}
        groups={bands}
        currentGroupId={activeBandId}
        onSwitchGroup={(id) => {
          if (id === activeBandId) return;
          setCurrentGroupId(id);
          try {
            localStorage.setItem(currentGroupStorageKey, id);
          } catch {
            // ignore
          }
          // filterSongId is cleared by an effect on activeBandId change.
          resetProjectScopedUiState();
        }}
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
        onOpenGroups={() => setGroupSettingsOpen(true)}
        onCreateGroup={() => setCreateGroupOpen(true)}
        onDownloadAll={onDownloadAll}
        currentProjectId={activeProjectId}
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
        audioLoading={player.state.loading !== null}
        loopEnabled={!!player.state.loop?.enabled || player.state.loopArmed}
        loopArmed={player.state.loopArmed}
        waveformNormalization={player.state.waveformNormalization}
        masterVolume={player.state.masterVolume}
        currentTime={player.currentTime}
        duration={player.state.duration}
        annotationCreateMode={annotationCreateMode}
        canCreateAnnotations={activeProjectId !== null}
        sectionCreateMode={sectionCreateMode}
        canCreateSections={activeProjectId !== null}
        markersVisible={markersVisible}
        railCollapsed={railCollapsed}
        showRailToggle={true}
        isWide={isWide}
        onSeek={player.seek}
        onTogglePlay={() => void player.togglePlay()}
        onToggleLoopEnabled={player.toggleLoopEnabled}
        onToggleWaveformNormalization={player.toggleWaveformNormalization}
        onToggleAnnotationCreate={handleAddButton}
        onToggleSectionCreate={() => {
          setSectionCreateMode((v) => !v);
          // Mutually exclusive with comment-create mode so a click on the
          // wave doesn't fire both handlers.
          setAnnotationCreateMode(false);
        }}
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
          {showUploadButton && activeBand && (
            <button
              type="button"
              className="draft-banner-save"
              onClick={() => setUploadOpen(true)}
            >
              Save to <span className="band-name-clip">{activeBand.name}</span>
            </button>
          )}
        </div>
      )}
      <div className="app-body">
        <div style={{ position: 'relative', minHeight: 0, minWidth: 0 }}>
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
              sections={sections}
              songUseCounts={songUseCounts}
              activeSectionId={activeSectionId}
              sectionCreateMode={sectionCreateMode}
              onSectionSelected={handleSectionSelected}
              onSectionCreated={handleSectionCreatedAtClick}
              onPatchSection={handleSectionPatchStart}
              onPatchAnnotation={handleAnnotationPatchRange}
              selfUserId={user.id}
              onToggleSectionCreate={() => setSectionCreateMode((v) => !v)}
              railCollapsed={railCollapsed}
              contentEntering={contentEntering}
              canMutate={player.state.stems.length > 0}
              onOpenPicker={openPicker}
              onRenameStem={(id, name) => void renameStem(id, name)}
              onDeleteStem={(id) => void deleteStem(id)}
              viewport={viewport}
              onDismissPopovers={closePopovers}
            />
          </ErrorBoundary>
          <SectionHintChip
            visible={isMobile && sections.length > 0 && showSectionHint}
            onDismiss={dismissSectionHint}
          />
        </div>
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
                selfDisplayName={selfDisplayName}
                selfColor={selfColor}
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
                replies={replies}
                onLoadReplies={loadReplies}
                onCreateReply={createReply}
                onEditReply={editReply}
                onDeleteReply={deleteReply}
                onToggleReaction={toggleReaction}
              />
              {!drawerOpen && (
                <CommentsFab
                  count={annotations.length}
                  starredCount={annotations.filter((a) => a.starred).length}
                  onClick={toggleDrawer}
                />
              )}
              {active && popoverAnchor && !isNarrow && !drawerOpen &&
                createPortal(
                  <div
                    data-testid="comment-popover-scrim"
                    className="surface-scrim"
                    role="presentation"
                    aria-hidden="true"
                    onClick={() => { setActiveCommentId(null); setPopoverAnchor(null); }}
                  />,
                  document.body,
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
                    selfUserId={user.id}
                    selfDisplayName={selfDisplayName}
                    selfColor={selfColor}
                    userColorMap={userColorMap}
                    isNarrow={isNarrow}
                    replies={replies.get(active.id)}
                    onLoadReplies={loadReplies}
                    onCreateReply={createReply}
                    onEditReply={editReply}
                    onDeleteReply={deleteReply}
                    onToggleReaction={toggleReaction}
                  />,
                  document.body,
                )}
              {active && isNarrow && !drawerOpen &&
                createPortal(
                  <div
                    data-testid="comment-sheet-scrim"
                    className="surface-scrim"
                    role="presentation"
                    aria-hidden="true"
                    onClick={() => { setActiveCommentId(null); setPopoverAnchor(null); }}
                  />,
                  document.body,
                )}
              {active && isNarrow && !drawerOpen &&
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
                        selfUserId={user.id}
                        selfDisplayName={selfDisplayName}
                        selfColor={selfColor}
                        userColorMap={userColorMap}
                        replies={replies.get(active.id)}
                        onLoadReplies={loadReplies}
                        onCreateReply={createReply}
                        onEditReply={editReply}
                        onDeleteReply={deleteReply}
                        onToggleReaction={toggleReaction}
                      />
                    );
                  })(),
                  document.body,
                )}
            </>
          );
        })()}
      </div>
      <ProjectPicker
        open={pickerOpen}
        loading={projectsLoading}
        loadError={loadError}
        projects={projects}
        activeProjectId={activeProjectId}
        currentUserId={user.id}
        showUpload={showUploadButton}
        bandSongs={songs}
        songUsage={songUsage}
        filterSongId={filterSongId}
        onSetFilterSongId={setFilterSongId}
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
          bandName={activeBand?.name ?? null}
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
      <GroupsDrawer
        open={groupSettingsOpen}
        groups={bands}
        currentGroupId={activeBandId}
        onClose={() => setGroupSettingsOpen(false)}
        onLeft={(leftId) => {
          // If the user left the active group, we need the same race-avoiding
          // local drop the single-group drawer used to do: pull it out of
          // `bands` eagerly so the fallback effect re-elects a different
          // group before the server refresh lands. For non-active groups,
          // we still want the local drop so the row disappears immediately;
          // the active-group resets only kick in when relevant.
          const wasActive = leftId === activeBandId;
          dropBandLocally(leftId);
          if (wasActive) {
            try {
              localStorage.removeItem(currentGroupStorageKey);
            } catch {
              // ignore
            }
            resetProjectScopedUiState();
          }
          refreshBands();
        }}
        onDeleted={(deletedId) => {
          // Same race-avoiding cleanup as the leave path: the deleting user
          // is the owner, so they're also leaving (the band is now soft-
          // deleted and disappears from /api/bands for everyone, including
          // them).
          const wasActive = deletedId === activeBandId;
          dropBandLocally(deletedId);
          if (wasActive) {
            try {
              localStorage.removeItem(currentGroupStorageKey);
            } catch {
              // ignore
            }
            resetProjectScopedUiState();
          }
          refreshBands();
        }}
        onRenamed={(groupId, newName) => {
          updateBandLocally(groupId, { name: newName });
        }}
        onCreateGroup={() => {
          setGroupSettingsOpen(false);
          setCreateGroupOpen(true);
        }}
      />
      <CreateGroupDialog
        open={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        onCreated={(group) => {
          // Switch into the new group: add locally, clear project-scoped
          // state, set as current, persist, refresh. Doing it eagerly
          // (not just relying on the slice-1 fallback effect once refresh
          // lands) avoids a flash where activeBand still points at the
          // old group while the new bands list is in flight.
          addBandLocally(group);
          setCurrentGroupId(group.id);
          try {
            localStorage.setItem(currentGroupStorageKey, group.id);
          } catch {
            // ignore
          }
          setCreateGroupOpen(false);
          resetProjectScopedUiState();
          refreshBands();
        }}
      />
      {sectionPopover &&
        createPortal(
          <>
            <div
              className="projectpicker-scrim"
              role="presentation"
              onClick={() => setSectionPopover(null)}
              aria-hidden="true"
            />
            <SectionPopover
              open={true}
              section={sectionPopover.section}
              startMs={sectionPopover.startMs}
              bandSongs={songs}
              runningSection={findRunningSection(sections, sectionPopover.startMs)}
              anchorLeftPx={sectionPopover.anchorLeft}
              anchorTopPx={sectionPopover.anchorTop}
              onSubmit={(payload) => void handleSectionSubmit(payload)}
              onDelete={
                sectionPopover.section ? () => void handleSectionDelete() : undefined
              }
              onClose={() => setSectionPopover(null)}
            />
          </>,
          document.body,
        )}
      {songToast &&
        createPortal(
          <div className="song-toast" role="status">
            <span>{songToast.message}</span>
            <button
              type="button"
              className="song-toast-undo"
              onClick={() => {
                songToast.onUndo();
              }}
            >
              Undo
            </button>
          </div>,
          document.body,
        )}
    </div>
    </PresenceProvider>
  );
}

function PresenceTracker({ projectId }: { projectId: string | null }) {
  usePresentIn(projectId);
  return null;
}
