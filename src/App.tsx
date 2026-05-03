import { useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Player } from './components/Player';
import { Sidebar } from './components/Sidebar';
import { StaticPracticesRepo } from './data/practices-repo';
import type { Practice, StemSource } from './data/types';
import { useKeyboard } from './hooks/useKeyboard';
import { usePlayer } from './hooks/usePlayer';
import { downloadStemsAsZip } from './lib/download';

const repo = new StaticPracticesRepo();

export default function App() {
  const player = usePlayer();
  useKeyboard(player);

  const [practices, setPractices] = useState<Practice[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activePracticeId, setActivePracticeId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    repo.list().then(
      (list) => {
        if (cancelled) return;
        setPractices(list);
        if (list.length > 0) selectPractice(list[0].id, list);
      },
      (err: Error) => {
        if (!cancelled) setLoadError(err.message);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectPractice(id: string, list: Practice[] = practices) {
    const p = list.find((x) => x.id === id);
    if (!p) return;
    setActivePracticeId(id);
    setDrawerOpen(false);
    const sources: StemSource[] = p.stems.map((name) => ({
      name,
      src: `${import.meta.env.BASE_URL}${p.folder}${encodeURIComponent(name)}`,
    }));
    void player.load({ practiceId: p.id, title: p.title, sources });
  }

  function loadFolder(files: File[], folderName: string) {
    setDrawerOpen(false);
    if (!files.length) {
      void player.load({ practiceId: null, title: folderName || 'Local folder', sources: [] });
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

  return (
    <>
      <header className="topbar">
        <button
          type="button"
          className="menu-btn"
          aria-label="Open practices menu"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          ☰
        </button>
        <h1 className="brand">Paperstem</h1>
        <span className="topbar-spacer" />
      </header>
      <div className="app">
        <Sidebar
          practices={practices}
          activePracticeId={activePracticeId}
          loadError={loadError}
          drawerOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onSelect={(id) => selectPractice(id)}
          onLoadFolder={loadFolder}
        />
        {drawerOpen && (
          <div
            className="scrim show"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
        )}
        <ErrorBoundary>
          <Player player={player} onDownloadAll={onDownloadAll} downloading={downloading} />
        </ErrorBoundary>
      </div>
    </>
  );
}
