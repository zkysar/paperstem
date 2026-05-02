import { useEffect, useState } from 'react';
import { StaticPracticesRepo } from './data/practices-repo';
import type { Practice } from './data/types';

const repo = new StaticPracticesRepo();

export default function App() {
  const [practices, setPractices] = useState<Practice[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    repo.list().then(
      (list) => {
        if (!cancelled) setPractices(list);
      },
      (err: Error) => {
        if (!cancelled) setLoadError(err.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <h1 className="brand">Paperstem</h1>
        <div className="brand-tag">Practices</div>
        {loadError && (
          <div className="empty" style={{ fontSize: '0.78rem' }}>
            Could not load practices.json ({loadError}).
          </div>
        )}
        {!loadError && (
          <ul className="practice-list">
            {practices.length === 0 && (
              <li className="empty" style={{ fontSize: '0.78rem' }}>
                Loading…
              </li>
            )}
            {practices.map((p) => (
              <li key={p.id} className="practice-item">
                <span className="practice-title">{p.title}</span>
                <span className="practice-meta">
                  {p.folder.replace(/\/$/, '')} · {p.stems.length} stems
                </span>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <main className="player">
        <div className="player-header">
          <div>
            <div className="player-meta">Practice</div>
            <div className="player-title">—</div>
          </div>
        </div>
        <div className="empty">Select a practice from the sidebar.</div>
      </main>
    </div>
  );
}
