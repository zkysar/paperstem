import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { Playhead } from './components/Playhead';
import { Ruler } from './components/Ruler';

function DebugStage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [diag, setDiag] = useState<string>('');

  useEffect(() => {
    const measure = () => {
      const stage = stageRef.current;
      const ruler = rulerRef.current;
      if (!stage || !ruler) return;
      const sr = stage.getBoundingClientRect();
      const rr = ruler.getBoundingClientRect();
      const labels = stage.querySelectorAll('.ruler-label');
      const label0 = labels[0]?.getBoundingClientRect();
      const ph = stage.querySelector('.playhead')?.getBoundingClientRect();
      setDiag(JSON.stringify({
        stageLeft: sr.left,
        rulerLeft: rr.left,
        diff_ruler_minus_stage: rr.left - sr.left,
        label0Left: label0?.left,
        playheadLeft: ph?.left,
        diff_playhead_minus_label0: ph && label0 ? ph.left - label0.left : null,
      }, null, 2));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const duration = 300;
  // Mock the playheadLeft computation as Player.tsx does it.
  const stage = stageRef.current;
  const ruler = rulerRef.current;
  let wrLeft = 0;
  let wrWidth = 0;
  if (stage && ruler) {
    const sr = stage.getBoundingClientRect();
    const rr = ruler.getBoundingClientRect();
    wrLeft = rr.left - sr.left;
    wrWidth = rr.width;
  }
  const playheadLeft = wrLeft;

  return (
    <div className="app">
      <aside className="sidebar"><div className="brand">Paperstem</div><div className="brand-tag">Debug</div></aside>
      <main className="player">
        <div className="player-header">
          <div>
            <div className="player-meta">Practice</div>
            <div className="player-title">Debug practice</div>
          </div>
        </div>
        <div className="transport"><span className="ttime">0:00 / 5:00</span></div>
        <div className="stage" ref={stageRef}>
          <Ruler duration={duration} onPointerDown={() => {}} rulerRef={rulerRef} />
          <div className="tracks">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="track">
                <div className="track-rail">
                  <span className="swatch" style={{ background: '#c17446' }} />
                  <div className="track-info"><span className="track-name">stem-{i}.mp3</span></div>
                  <span className="ms-pills"><button className="pill mute">M</button><button className="pill solo">S</button></span>
                </div>
                <div className="wave"><div className="clip" style={{ width: '100%' }} /></div>
              </div>
            ))}
          </div>
          <Playhead visible={true} leftPx={playheadLeft} />
        </div>
        <pre style={{ fontSize: 11, padding: 8, background: '#fff', border: '1px solid #ccc', marginTop: 16 }}>{diag}</pre>
      </main>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('No #root element');
createRoot(root).render(<StrictMode><DebugStage /></StrictMode>);
