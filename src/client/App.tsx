import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoginScreen } from './auth/LoginScreen';
import { useBands } from './auth/useBands';
import { useSession } from './auth/useSession';
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
import { ErrorBoundary } from './components/ErrorBoundary';
import { FilePicker } from './components/FilePicker';
import { Player } from './components/Player';
import { UploadDrawer } from './components/UploadDrawer';
import {
  listAnnotations,
  createAnnotation,
  patchAnnotation,
  deleteAnnotation,
} from './data/annotations-repo';
import { HttpPracticesRepo, type PracticesRepo } from './data/practices-repo';
import type { Practice, StemSource, TrashList } from './data/types';
import { decodePeaks } from './lib/peaks';
import { useAppVersion } from './hooks/useAppVersion';
import { useKeyboard } from './hooks/useKeyboard';
import { usePlayer } from './hooks/usePlayer';
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
  const [pickerOpen, setPickerOpen] = useState(false);

  const { bands, loading: bandsLoading, error: bandsError } = useBands(true);
  const activeBand = bands[0] ?? null;
  const activeBandId = activeBand?.id ?? null;
  const repo = useMemo<PracticesRepo | null>(
    () => (activeBandId ? new HttpPracticesRepo(activeBandId) : null),
    [activeBandId],
  );

  const [practices, setPractices] = useState<Practice[]>([]);
  const [trash, setTrash] = useState<TrashList | null>(null);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [practicesLoading, setPracticesLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activePracticeId, setActivePracticeId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
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

  // Auto-open the picker once on mount when no practice is active.
  useEffect(() => {
    if (activePracticeId === null) setPickerOpen(true);
    // intentionally fires once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When activePracticeId transitions to null (e.g. the active practice was
  // deleted), reset the player so the header and waveform don't point at a
  // tombstone. Guarded with a ref so the initial null on mount doesn't fire
  // clear() before anything has been loaded.
  const prevActivePracticeIdRef = useRef<string | null>(activePracticeId);
  useEffect(() => {
    if (prevActivePracticeIdRef.current !== null && activePracticeId === null) {
      player.clear();
    }
    prevActivePracticeIdRef.current = activePracticeId;
  }, [activePracticeId, player]);

  useKeyboard({
    player,
    pickerOpen,
    drawerOpen,
    popoverOpen: activeCommentId !== null,
    annotationCreateMode,
    onTogglePicker: () => (pickerOpen ? closePicker() : openPicker()),
    onClosePicker: closePicker,
    onCloseDrawer: closeDrawer,
    onClosePopover: () => { setActiveCommentId(null); setPopoverAnchor(null); },
    onCancelCreate: () => {
      setAnnotationCreateMode(false);
      setPendingDraft(null);
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
      setPractices([]);
      setPracticesLoading(false);
      return;
    }
    let cancelled = false;
    setPracticesLoading(true);
    repo.list().then(
      (list) => {
        if (cancelled) return;
        setPractices(list);
        setLoadError(null);
        setPracticesLoading(false);
      },
      (err: Error) => {
        if (cancelled) return;
        setLoadError(err.message);
        setPracticesLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repo]);

  async function refreshPractices(): Promise<Practice[]> {
    if (!repo) return [];
    try {
      const list = await repo.list();
      setPractices(list);
      setLoadError(null);
      setPracticesLoading(false);
      return list;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg);
      setPracticesLoading(false);
      throw err;
    }
  }

  async function handleUploaded(practiceId: string) {
    setUploadOpen(false);
    try {
      await refreshPractices();
      await selectPractice(practiceId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg);
    }
  }

  const deletePractice = useCallback(
    async (id: string) => {
      if (!repo) return;
      let prev: Practice[] = [];
      setPractices((arr) => {
        prev = arr;
        return arr.filter((p) => p.id !== id);
      });
      if (activePracticeId === id) {
        setActivePracticeId(null);
        // Reset the player explicitly so the header and waveform clear before
        // the activePracticeId effect fires on the next render — keeps the UI
        // from briefly displaying the deleted practice's metadata.
        player.clear();
        setActiveCommentId(null);
        setPopoverAnchor(null);
        setAnnotations([]);
      }
      try {
        await repo.deletePractice(id);
      } catch (err) {
        console.error('delete failed', err);
        setPractices(prev);
      }
    },
    [repo, activePracticeId, player],
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

  const restorePractice = useCallback(
    async (id: string) => {
      if (!repo) return;
      try {
        await repo.restorePractice(id);
      } catch (err) {
        console.error('restore failed', err);
        return;
      }
      try {
        const fresh = await repo.list();
        setPractices(fresh);
      } catch (_err) { /* ignore */ }
      await loadTrash();
    },
    [repo, loadTrash],
  );

  // Core: fetch a practice by id and populate player + annotations. Shared by
  // selectPractice (user-driven switch) and reloadActive (refresh the current
  // practice in place — used after stem restore / failed stem delete to bring
  // server truth back into the player without resetting create-mode etc).
  const loadPractice = useCallback(
    async (id: string, opts: { resetUiState: boolean }) => {
      if (!repo) return;
      if (opts.resetUiState) {
        setAnnotations([]);
        setPendingDraft(null);
        setAnnotationCreateMode(false);
        setActiveCommentId(null);
        setPopoverAnchor(null);
      }
      try {
        const detail = await repo.getById(id);
        setPractices((prev) => prev.map((p) => (p.id === detail.id ? detail : p)));
        const sources: StemSource[] = detail.stems.map((s) => ({
          name: s.name,
          src: `/api/audio/${encodeURIComponent(s.id)}`,
          serverId: s.id,
          peaks: s.peaks ? decodePeaks(s.peaks) : null,
        }));
        void player.load({
          practiceId: detail.id,
          title: detail.title,
          driveFolderId: detail.driveFolderId,
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
    [repo, player],
  );

  const reloadActive = useCallback(async () => {
    if (!activePracticeId) return;
    await loadPractice(activePracticeId, { resetUiState: false });
  }, [activePracticeId, loadPractice]);

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
        // Best-effort recovery: re-load the active practice from the server so
        // the optimistic removal is reverted with authoritative data.
        await reloadActive();
      }
    },
    [repo, player, reloadActive],
  );

  const renamePractice = useCallback(
    async (id: string, name: string) => {
      if (!repo) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      let prev: Practice[] = [];
      setPractices((arr) => {
        prev = arr;
        return arr.map((p) => (p.id === id ? { ...p, title: trimmed } : p));
      });
      // Reflect the rename in the player title too (header reads player.state.title).
      player.setTitle(trimmed);
      try {
        await repo.renamePractice(id, trimmed);
      } catch (err) {
        console.error('rename failed', err);
        setPractices(prev);
        const reverted = prev.find((p) => p.id === id);
        if (reverted) player.setTitle(reverted.title);
      }
    },
    [repo, player],
  );

  const selectPractice = useCallback(
    async (id: string) => {
      if (!repo) return;
      setActivePracticeId(id);
      await loadPractice(id, { resetUiState: true });
    },
    [repo, loadPractice],
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
    if (!activePracticeId || !pendingDraft) return;
    const created = await createAnnotation(activePracticeId, {
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
      void player.load({
        practiceId: null,
        title: folderName || 'Local folder',
        driveFolderId: null,
        sources: [],
      });
      return;
    }
    const sources: StemSource[] = files.map((f) => {
      const url = URL.createObjectURL(f);
      return { name: f.name, src: url, revoke: () => URL.revokeObjectURL(url) };
    });
    setActivePracticeId(null);
    void player.load({
      practiceId: `local:${folderName}`,
      title: folderName,
      driveFolderId: null,
      sources,
    });
  }

  async function onDownloadAll() {
    if (!player.state.stems.length) return;
    setDownloading(true);
    try {
      const filename = `${activePracticeId || 'paperstem'}-stems.zip`;
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
      <AppHeader
        userEmail={user.email}
        userInitials={initialsFromEmail(user.email)}
        practiceTitle={player.state.title || null}
        stemCount={player.state.stems.length}
        duration={player.state.duration}
        driveFolderId={player.state.driveFolderId ?? null}
        annotationsOpen={drawerOpen}
        hasPractice={player.state.stems.length > 0}
        canRename={Boolean(activePracticeId)}
        appVersion={appInfo?.version ?? null}
        appEnv={appInfo?.env ?? null}
        onOpenPicker={openPicker}
        onToggleAnnotations={toggleDrawer}
        onSignOut={onLogout}
        onReportBug={() => openBugReport()}
        onRenamePractice={(name) => {
          if (activePracticeId) void renamePractice(activePracticeId, name);
        }}
      />
      <AppToolbar
        hasPractice={player.state.stems.length > 0}
        isPlaying={player.state.isPlaying}
        hasLoop={!!player.state.loop}
        loopEnabled={!!player.state.loop?.enabled}
        downloading={downloading}
        waveformNormalization={player.state.waveformNormalization}
        masterVolume={player.state.masterVolume}
        currentTime={player.currentTime}
        duration={player.state.duration}
        annotationCreateMode={annotationCreateMode}
        canCreateAnnotations={activePracticeId !== null}
        markersVisible={markersVisible}
        railCollapsed={railCollapsed}
        showRailToggle={true}
        isWide={isWide}
        onSeek={player.seek}
        onTogglePlay={() => void player.togglePlay()}
        onToggleLoopEnabled={player.toggleLoopEnabled}
        onDownloadAll={onDownloadAll}
        onToggleWaveformNormalization={player.toggleWaveformNormalization}
        onToggleAnnotationCreate={handleAddButton}
        onToggleMarkersVisible={() => setMarkersVisible((v) => !v)}
        onSetMasterVolume={player.setMasterVolume}
        onToggleRailCollapsed={() => setRailCollapsed((v) => !v)}
      />
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
            canMutate={Boolean(activePracticeId)}
            onOpenPicker={openPicker}
            onRenameStem={(id, name) => void renameStem(id, name)}
            onDeleteStem={(id) => void deleteStem(id)}
          />
        </ErrorBoundary>
        {(() => {
          const active = annotations.find((a) => a.id === activeCommentId) ?? null;
          const isNarrow = railCollapsed;
          const color =
            (active && userColorMap.get(active.user_id)) ?? '#c17446';
          return (
            <>
              <CommentsDrawer
                key={activePracticeId ?? 'none'}
                open={drawerOpen}
                isNarrow={isNarrow}
                selfUserId={user.id}
                canEdit={activePracticeId !== null}
                annotations={annotations}
                userColorMap={userColorMap}
                activeId={activeCommentId}
                pendingDraft={pendingDraft}
                onClose={closeDrawer}
                onSelect={handleAnnotationSelected}
                onCreate={(body) => void handleCreateFromDraft(body)}
                onDraftCancel={() => setPendingDraft(null)}
                onToggleStar={(a) => void handleToggleStar(a)}
                onSaveEdit={(a, body) => void handleSaveEdit(a, body)}
                onDelete={(a) => void handleDelete(a)}
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
                    canEdit={activePracticeId !== null}
                    isOwn={active.user_id === user.id}
                    drawerOpen={drawerOpen}
                    onLoopRegion={() => handleLoopAnnotation(active)}
                    onToggleStar={() => void handleToggleStar(active)}
                    onSaveEdit={(body) => void handleSaveEdit(active, body)}
                    onDelete={() => void handleDelete(active)}
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
                        canEdit={activePracticeId !== null}
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
        loading={practicesLoading}
        loadError={loadError}
        practices={practices}
        activePracticeId={activePracticeId}
        showUpload={showUploadButton}
        onClose={closePicker}
        onSelect={(id) => {
          void selectPractice(id);
          closePicker();
        }}
        onLoadFolder={(files, folderName) => {
          loadFolder(files, folderName);
          closePicker();
        }}
        onUploadClick={() => setUploadOpen(true)}
        onRetry={() => {
          setPracticesLoading(true);
          void refreshPractices().catch(() => {});
        }}
        onRenamePractice={(id, name) => {
          void renamePractice(id, name);
        }}
        onDeletePractice={(id) => {
          void deletePractice(id);
        }}
        trash={trash}
        trashError={trashError}
        onLoadTrash={() => {
          void loadTrash();
        }}
        onRestorePractice={(id) => {
          void restorePractice(id);
        }}
        onRestoreStem={(id) => {
          void restoreStem(id);
        }}
      />
      {showUploadButton && activeBandId && (
        <UploadDrawer
          bandId={activeBandId}
          open={uploadOpen}
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
          activePracticeId,
          practiceTitle: player.state.title ?? null,
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
    </div>
  );
}
