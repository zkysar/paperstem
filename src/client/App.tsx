import { useCallback, useEffect, useMemo, useState } from 'react';
import { LoginScreen } from './auth/LoginScreen';
import { useBands } from './auth/useBands';
import { useSession } from './auth/useSession';
import {
  AnnotationsDrawer,
  type AnnotationDraft,
} from './components/AnnotationsDrawer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Player } from './components/Player';
import { Sidebar } from './components/Sidebar';
import { UploadDrawer } from './components/UploadDrawer';
import { listAnnotations } from './data/annotations-repo';
import { HttpProjectsRepo, type ProjectsRepo } from './data/projects-repo';
import type { Project, StemSource } from './data/types';
import { useKeyboard } from './hooks/useKeyboard';
import { usePlayer } from './hooks/usePlayer';
import { buildUserColorMap } from './lib/colors';
import { downloadStemsAsZip } from './lib/download';
import type { Annotation, User } from '../shared/types';

const UPLOAD_MIN_VIEWPORT_PX = 720;

export default function App() {
  const { user, loading, logout } = useSession();
  if (loading) return null;
  if (!user) return <LoginScreen />;
  return <PaperstemApp user={user} onLogout={logout} />;
}

function PaperstemApp({ user, onLogout }: { user: User; onLogout: () => void }) {
  const player = usePlayer();
  useKeyboard(player);

  const { bands, loading: bandsLoading, error: bandsError } = useBands(true);
  const activeBand = bands[0] ?? null;
  const activeBandId = activeBand?.id ?? null;
  const repo = useMemo<ProjectsRepo | null>(
    () => (activeBandId ? new HttpProjectsRepo(activeBandId) : null),
    [activeBandId],
  );

  const [projects, setProjects] = useState<Project[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [annotationCreateMode, setAnnotationCreateMode] = useState(false);
  const [markersVisible, setMarkersVisible] = useState(true);
  const [pendingDraft, setPendingDraft] = useState<AnnotationDraft | null>(null);
  const [highlightAnnotationId, setHighlightAnnotationId] = useState<
    string | null
  >(null);

  const userColorMap = useMemo(
    () => buildUserColorMap(annotations.map((a) => a.user_id), user.id),
    [annotations, user.id],
  );

  useEffect(() => {
    if (!annotationCreateMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setAnnotationCreateMode(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [annotationCreateMode]);
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

  const showUploadButton =
    isWide && activeBand !== null && activeBand.role === 'owner';

  useEffect(() => {
    if (!repo) {
      setProjects([]);
      return;
    }
    let cancelled = false;
    repo.list().then(
      (list) => {
        if (cancelled) return;
        setProjects(list);
        setLoadError(null);
      },
      (err: Error) => {
        if (!cancelled) setLoadError(err.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repo]);

  async function refreshProjects(): Promise<Project[]> {
    if (!repo) return [];
    const list = await repo.list();
    setProjects(list);
    setLoadError(null);
    return list;
  }

  async function handleUploaded(projectId: string) {
    setUploadOpen(false);
    try {
      await refreshProjects();
      await selectProject(projectId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg);
    }
  }

  async function selectProject(id: string) {
    if (!repo) return;
    setActiveProjectId(id);
    setDrawerOpen(false);
    setAnnotations([]);
    setPendingDraft(null);
    setAnnotationCreateMode(false);
    setHighlightAnnotationId(null);
    try {
      const detail = await repo.getById(id);
      setProjects((prev) => prev.map((p) => (p.id === detail.id ? detail : p)));
      const sources: StemSource[] = detail.stems.map((stemId) => ({
        name: stemId,
        src: `/api/audio/${encodeURIComponent(stemId)}`,
      }));
      void player.load({
        projectId: detail.id,
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
  }

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
    setDrawerOpen(false);
    if (!files.length) {
      void player.load({
        projectId: null,
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
    setActiveProjectId(null);
    void player.load({
      projectId: `local:${folderName}`,
      title: folderName,
      driveFolderId: null,
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
    <>
      <header className="topbar">
        <button
          type="button"
          className="menu-btn"
          aria-label="Open projects menu"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          ☰
        </button>
        <h1 className="brand">Paperstem</h1>
        <span className="topbar-spacer" />
        <button type="button" className="logout-btn" onClick={onLogout}>
          Sign out
        </button>
      </header>
      <div className="app">
        <Sidebar
          projects={projects}
          activeProjectId={activeProjectId}
          loadError={loadError}
          drawerOpen={drawerOpen}
          userEmail={user.email}
          showUpload={showUploadButton}
          onClose={() => setDrawerOpen(false)}
          onSelect={(id) => void selectProject(id)}
          onLoadFolder={loadFolder}
          onUploadClick={() => setUploadOpen(true)}
          onLogout={onLogout}
        />
        {showUploadButton && activeBandId && (
          <UploadDrawer
            bandId={activeBandId}
            open={uploadOpen}
            onClose={() => setUploadOpen(false)}
            onUploaded={(id) => void handleUploaded(id)}
          />
        )}
        {drawerOpen && (
          <div
            className="scrim show"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
        )}
        <ErrorBoundary>
          <Player
            player={player}
            onDownloadAll={onDownloadAll}
            downloading={downloading}
            annotations={annotations}
            userColorMap={userColorMap}
            markersVisible={markersVisible}
            annotationsOpen={annotationsOpen}
            onToggleAnnotations={() => setAnnotationsOpen((v) => !v)}
            annotationCreateMode={annotationCreateMode}
            onToggleAnnotationCreate={() =>
              setAnnotationCreateMode((v) => !v)
            }
            onAnnotationCreated={handleAnnotationCreated}
            onAnnotationSelected={handleAnnotationSelected}
            canCreateAnnotations={activeProjectId !== null}
            pendingDraft={pendingDraft}
          />
        </ErrorBoundary>
        <AnnotationsDrawer
          open={annotationsOpen}
          projectId={activeProjectId}
          selfUserId={user.id}
          canEdit={activeProjectId !== null}
          annotations={annotations}
          userColorMap={userColorMap}
          markersVisible={markersVisible}
          pendingDraft={pendingDraft}
          highlightId={highlightAnnotationId}
          onClose={() => {
            setAnnotationsOpen(false);
            setPendingDraft(null);
          }}
          onSeek={(seconds) => player.seek(seconds)}
          onAnnotationsChange={setAnnotations}
          onDraftCancel={() => setPendingDraft(null)}
          onToggleMarkersVisible={() => setMarkersVisible((v) => !v)}
          onLoopAnnotation={handleLoopAnnotation}
        />
      </div>
    </>
  );
}
