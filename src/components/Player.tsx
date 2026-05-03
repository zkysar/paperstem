import { useEffect, useRef, useState } from 'react';
import type { PlayerControls } from '../hooks/usePlayer';
import { fmt, pixelToTime } from '../lib/format';
import { LoopRegion } from './LoopRegion';
import { Playhead } from './Playhead';
import { Ruler } from './Ruler';
import { Track } from './Track';

const DRAG_THRESHOLD_PX = 4;
const MIN_LOOP_SEC = 0.05;

type DragMode = 'create' | 'move' | 'resize-left' | 'resize-right';

type Drag = {
  mode: DragMode;
  originX: number;
  originTime: number;
  originStart: number;
  originEnd: number;
  didMove: boolean;
  // Most recent (start, end) the drag set on the player. Used by onUp to
  // decide whether to auto-enable or discard, since reading player.state
  // from the onUp closure would see stale data.
  lastStart: number | null;
  lastEnd: number | null;
};

type Props = {
  player: PlayerControls;
  onDownloadAll(): void;
  downloading: boolean;
};

export function Player({ player, onDownloadAll, downloading }: Props) {
  const { state, currentTime } = player;
  const { stems, duration, loop, isPlaying, focusedIdx, status, title } = state;

  const stageRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);

  // Wave area geometry: re-measured on each render so overlay positions
  // (playhead, loop region) follow window resizes without explicit listeners.
  // The ruler is in the same grid column as the wave clips, so we use its
  // rect as the canonical x-axis.
  const [, forceRender] = useState(0);
  useEffect(() => {
    const onResize = () => forceRender((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function getWaveRect(): { left: number; width: number } {
    const stage = stageRef.current;
    const ruler = rulerRef.current;
    if (!stage || !ruler) return { left: 0, width: 0 };
    const stageRect = stage.getBoundingClientRect();
    const rulerRect = ruler.getBoundingClientRect();
    return {
      left: rulerRect.left - stageRect.left,
      width: rulerRect.width,
    };
  }

  // Convert a clientX to a song time using the ruler's live bounding rect.
  function xToTime(clientX: number): number {
    const ruler = rulerRef.current;
    if (!ruler) return 0;
    const r = ruler.getBoundingClientRect();
    return pixelToTime(clientX - r.left, r.width, duration);
  }

  // Drag state machine for the ruler / loop region. Plain locals (not
  // useCallback) so each render's handlers see the latest waveRect/duration
  // when a drag begins.
  const dragRef = useRef<Drag | null>(null);

  function startDrag(d: Drag) {
    dragRef.current = d;
    function onMove(e: MouseEvent) {
      const cur = dragRef.current;
      if (!cur) return;
      const dx = e.clientX - cur.originX;
      if (Math.abs(dx) > DRAG_THRESHOLD_PX) cur.didMove = true;
      const t = xToTime(e.clientX);

      let ns: number, ne: number;
      if (cur.mode === 'create') {
        if (!cur.didMove) return;
        ns = Math.min(cur.originTime, t);
        ne = Math.max(cur.originTime, t);
      } else if (cur.mode === 'move') {
        const r = getWaveRect();
        const ddt = r.width ? (dx / r.width) * duration : 0;
        ns = cur.originStart + ddt;
        ne = cur.originEnd + ddt;
        const w = ne - ns;
        if (ns < 0) {
          ns = 0;
          ne = w;
        }
        if (ne > duration) {
          ne = duration;
          ns = duration - w;
        }
      } else if (cur.mode === 'resize-left') {
        ns = Math.max(0, Math.min(t, cur.originEnd - MIN_LOOP_SEC));
        ne = cur.originEnd;
      } else {
        // resize-right
        ns = cur.originStart;
        ne = Math.min(duration, Math.max(t, cur.originStart + MIN_LOOP_SEC));
      }
      cur.lastStart = ns;
      cur.lastEnd = ne;
      player.setLoop(ns, ne);
    }
    function onUp(e: MouseEvent) {
      const cur = dragRef.current;
      if (!cur) return;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      dragRef.current = null;

      if (!cur.didMove) {
        const t = xToTime(e.clientX);
        if (cur.mode === 'create') {
          if (player.state.loop) player.clearLoop();
          else player.seek(t);
        } else {
          player.seek(t);
        }
      } else if (cur.mode === 'create') {
        if (cur.lastStart != null && cur.lastEnd != null && cur.lastEnd - cur.lastStart >= MIN_LOOP_SEC) {
          player.setLoopEnabled(true);
        } else {
          player.clearLoop();
        }
      }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function onRulerMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!duration) return;
    if (e.button !== 0) return;
    const t = xToTime(e.clientX);
    startDrag({
      mode: 'create',
      originX: e.clientX,
      originTime: t,
      originStart: 0,
      originEnd: 0,
      didMove: false,
      lastStart: null,
      lastEnd: null,
    });
    e.preventDefault();
  }

  function onLoopMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!duration || !loop) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const handle = target.closest('.loop-handle') as HTMLElement | null;
    const mode: DragMode = handle
      ? handle.dataset.handle === 'left'
        ? 'resize-left'
        : 'resize-right'
      : 'move';
    startDrag({
      mode,
      originX: e.clientX,
      originTime: 0,
      originStart: loop.start,
      originEnd: loop.end,
      didMove: false,
      lastStart: null,
      lastEnd: null,
    });
    e.stopPropagation();
    e.preventDefault();
  }

  const wr = getWaveRect();
  const playheadLeft = duration
    ? wr.left + (Math.min(currentTime, duration) / duration) * wr.width
    : 0;
  const loopLeft = loop && duration ? wr.left + (loop.start / duration) * wr.width : 0;
  const loopWidth = loop && duration ? ((loop.end - loop.start) / duration) * wr.width : 0;

  // Effective mute: if any stem is soloed, non-soloed are muted.
  const anySolo = stems.some((s) => s.soloed);

  return (
    <main className="player">
      <div className="player-header">
        <div>
          <div className="player-meta">Practice</div>
          <div className="player-title">{title}</div>
        </div>
        <div className="player-meta">
          {stems.length ? `${stems.length} stems · ${fmt(duration)}` : ''}
        </div>
      </div>

      <div className="transport">
        <button
          type="button"
          className="tbtn"
          title="Restart"
          disabled={!stems.length}
          onClick={() => player.seek(0)}
        >
          ⏮
        </button>
        <button
          type="button"
          className="tbtn play"
          title="Play / Pause (Space)"
          disabled={!stems.length}
          onClick={() => {
            void player.togglePlay();
          }}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          type="button"
          className={'tbtn loop' + (loop?.enabled ? ' on' : '')}
          title="Toggle loop (L)"
          disabled={!loop}
          onClick={() => player.toggleLoopEnabled()}
        >
          ⟲
        </button>
        <button
          type="button"
          className="tbtn"
          title="Download all stems"
          disabled={!stems.length || downloading}
          onClick={onDownloadAll}
        >
          {downloading ? '…' : '⤓'}
        </button>
        <span className="ttime">
          {fmt(currentTime)} / {fmt(duration)}
        </span>
      </div>

      <div className="stage" ref={stageRef}>
        <Ruler duration={duration} onMouseDown={onRulerMouseDown} rulerRef={rulerRef} />
        <div className="tracks" ref={tracksRef}>
          {!stems.length && <div className="empty">No practice loaded.</div>}
          {stems.map((stem, i) => (
            <Track
              key={`${stem.practiceId ?? 'local'}-${stem.name}`}
              stem={stem}
              idx={i}
              focused={i === focusedIdx}
              effectiveMuted={anySolo ? !stem.soloed : stem.userMuted}
              durationRef={duration}
              onFocus={player.focusStem}
              onToggleMute={player.toggleMute}
              onToggleSolo={player.toggleSolo}
              onSetVolume={player.setVolume}
              onSeek={player.seek}
            />
          ))}
        </div>
        <LoopRegion
          visible={!!loop}
          enabled={!!loop?.enabled}
          leftPx={loopLeft}
          widthPx={loopWidth}
          onMouseDown={onLoopMouseDown}
        />
        <Playhead visible={!!stems.length && !!duration} leftPx={playheadLeft} />
      </div>

      <div className="status">{status}</div>

      <div className="keys-hint">
        <strong>Keys:</strong> <kbd>Space</kbd> play/pause &middot; <kbd>L</kbd> loop on/off
        &middot; <kbd>Esc</kbd> clear loop &middot; <kbd>M</kbd>/<kbd>S</kbd> mute/solo focused
        track &middot; drag the ruler to set a loop region
      </div>
    </main>
  );
}
