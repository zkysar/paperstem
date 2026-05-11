import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoginScreen } from './auth/LoginScreen';
import { useBands } from './auth/useBands';
import { useSession } from './auth/useSession';
import {
  AnnotationsRail,
  type AnnotationDraft,
} from './components/AnnotationsRail';
import { AppHeader } from './components/AppHeader';
import { AppToolbar } from './components/AppToolbar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FilePicker } from './components/FilePicker';
import { Player } from './components/Player';
import { UploadDrawer } from './components/UploadDrawer';
import { listAnnotations } from './data/annotations-repo';
import { HttpPracticesRepo, type PracticesRepo } from './data/practices-repo';
import type { Practice, StemSource, TrashList } from './data/types';
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
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [annotationCreateMode, setAnnotationCreateMode] = useState(false);
  const [markersVisible, setMarkersVisible] = useState(true);
  const [pendingDraft, setPendingDraft] = useState<AnnotationDraft | null>(null);
  const [highlightAnnotationId, setHighlightAnnotationId] = useState<
    string | null
  >(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(
    null,
  );

  const lastPickerTriggerRef = useRef<HTMLElement | null>(null);
  const lastRailTriggerRef = useRef<HTMLElement | null>(null);

  const openPicker = useCallback(() => {
    lastPickerTriggerRef.current = document.activeElement as HTMLElement | null;
    setPickerOpen(true);
  }, []);
  const closePicker = useCallback(() => {
    setPickerOpen(false);
    queueMicrotask(() => lastPickerTriggerRef.current?.focus());
  }, []);

  const openRail = useCallback(() => {
    lastRailTriggerRef.current = document.activeElement as HTMLElement | null;
    setAnnotationsOpen(true);
  }, []);
  const closeRail = useCallback(() => {
    setAnnotationsOpen(false);
    setPendingDraft(null);
    queueMicrotask(() => lastRailTriggerRef.current?.focus());
  }, []);
  const toggleRail = useCallback(() => {
    if (annotationsOpen) closeRail();
    else openRail();
  }, [annotationsOpen, openRail, closeRail]);

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
    annotationsOpen,
    annotationCreateMode,
    onTogglePicker: () => (pickerOpen ? closePicker() : openPicker()),
    onClosePicker: closePicker,
    onCloseRail: closeRail,
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
        setHighlightAnnotationId(null);
      }
      try {
        const detail = await repo.getById(id);
        setPractices((prev) => prev.map((p) => (p.id === detail.id ? detail : p)));
        const sources: StemSource[] = detail.stems.map((stemId) => ({
          name: stemId,
          src: `/api/audio/${encodeURIComponent(stemId)}`,
          serverId: stemId,
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
      setAnnotationsOpen(true);
      setPendingDraft({ start_ms, end_ms });
    },
    [],
  );

  const handleAnnotationSelected = useCallback(
    (annotation: Annotation) => {
      player.seek(annotation.start_ms / 1000);
      setAnnotationsOpen(true);
      setHighlightAnnotationId(annotation.id);
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
        annotationsOpen={annotationsOpen}
        hasPractice={player.state.stems.length > 0}
        canRename={Boolean(activePracticeId)}
        appVersion={appInfo?.version ?? null}
        appEnv={appInfo?.env ?? null}
        onOpenPicker={openPicker}
        onToggleAnnotations={toggleRail}
        onSignOut={onLogout}
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
        onToggleAnnotationCreate={() => setAnnotationCreateMode((v) => !v)}
        onToggleMarkersVisible={() => setMarkersVisible((v) => !v)}
        onSetMasterVolume={player.setMasterVolume}
        onToggleRailCollapsed={() => setRailCollapsed((v) => !v)}
      />
      <div className={'app-body' + (annotationsOpen ? ' rail-open' : '')}>
        <ErrorBoundary>
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
        <AnnotationsRail
          open={annotationsOpen}
          practiceId={activePracticeId}
          selfUserId={user.id}
          canEdit={activePracticeId !== null}
          annotations={annotations}
          userColorMap={userColorMap}
          markersVisible={markersVisible}
          pendingDraft={pendingDraft}
          highlightId={highlightAnnotationId}
          hoveredId={hoveredAnnotationId}
          onClose={closeRail}
          onSeek={(s) => player.seek(s)}
          onAnnotationsChange={setAnnotations}
          onDraftCancel={() => setPendingDraft(null)}
          onToggleMarkersVisible={() => setMarkersVisible((v) => !v)}
          onLoopAnnotation={handleLoopAnnotation}
          onHoverAnnotation={setHoveredAnnotationId}
        />
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
    </div>
  );
}
