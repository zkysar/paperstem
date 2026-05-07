import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Annotation } from '../../shared/types';
import type { PlayerControls } from '../hooks/usePlayer';
import { VOLUME_MAX, VOLUME_UNITY } from '../lib/audio';
import { fmt, pixelToTime } from '../lib/format';
import { AnnotationMarkers } from './AnnotationMarkers';
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
  annotations: Annotation[];
  userColorMap: Map<string, string>;
  markersVisible: boolean;
  annotationsOpen: boolean;
  onToggleAnnotations(): void;
  annotationCreateMode: boolean;
  onToggleAnnotationCreate(): void;
  onAnnotationCreated(start_ms: number, end_ms: number | null): void;
  onAnnotationSelected(annotation: Annotation): void;
  canCreateAnnotations: boolean;
};

export function Player({
  player,
  onDownloadAll,
  downloading,
  annotations,
  userColorMap,
  markersVisible,
  annotationsOpen,
  onToggleAnnotations,
  annotationCreateMode,
  onToggleAnnotationCreate,
  onAnnotationCreated,
  onAnnotationSelected,
  canCreateAnnotations,
}: Props) {
  const { state, currentTime } = player;
  const {
    stems,
    duration,
    loop,
    isPlaying,
    focusedIdx,
    status,
    title,
    driveFolderId,
    masterVolume,
    waveformNormalization,
  } = state;

  const stageRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);

  // The rail (track names + volume sliders + M/S pills) auto-collapses on
  // narrow viewports so the waveform takes the full width. The manual
  // toggle in the transport overrides this until the viewport next crosses
  // the breakpoint, at which point we follow the new default again.
  const [railCollapsed, setRailCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 720px)').matches;
  });
  useEffect(() => {
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

  // Wave area geometry: re-measured on each render so overlay positions
  // (playhead, loop region) follow size changes without explicit listeners.
  // The ruler is in the same grid column as the wave clips, so we use its
  // rect as the canonical x-axis.
  const [, forceRender] = useState(0);
  useEffect(() => {
    const reflow = () => forceRender((n) => n + 1);
    window.addEventListener('resize', reflow);
    return () => window.removeEventListener('resize', reflow);
  }, []);
  // The first render after `railCollapsed` flips computes overlay positions
  // against pre-commit DOM (old rail width). Re-measure synchronously after
  // the new className is committed so the playhead/loop overlay snap to
  // the new wave-area position rather than drifting to the previous spot.
  useLayoutEffect(() => {
    forceRender((n) => n + 1);
  }, [railCollapsed]);

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

  function startDrag(d: Drag, pointerId: number) {
    dragRef.current = d;
    function onMove(e: PointerEvent) {
      if (e.pointerId !== pointerId) return;
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
    function onUp(e: PointerEvent) {
      if (e.pointerId !== pointerId) return;
      const cur = dragRef.current;
      if (!cur) return;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      dragRef.current = null;

      if (!cur.didMove) {
        // A click (no drag) on the ruler or loop region always seeks the
        // playhead. The loop region is not destroyed by a stray click — use
        // Esc / the loop toggle to clear or disable it.
        const t = xToTime(e.clientX);
        player.seek(t);
      } else if (cur.mode === 'create') {
        if (cur.lastStart != null && cur.lastEnd != null && cur.lastEnd - cur.lastStart >= MIN_LOOP_SEC) {
          player.setLoopEnabled(true);
        } else {
          player.clearLoop();
        }
      }
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function onRulerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!duration) return;
    if (e.button !== 0) return;
    if (annotationCreateMode) return;
    const t = xToTime(e.clientX);
    startDrag(
      {
        mode: 'create',
        originX: e.clientX,
        originTime: t,
        originStart: 0,
        originEnd: 0,
        didMove: false,
        lastStart: null,
        lastEnd: null,
      },
      e.pointerId,
    );
    e.preventDefault();
  }

  const [annotationDragPreview, setAnnotationDragPreview] = useState<
    { start: number; end: number } | null
  >(null);

  function startAnnotationDrag(originX: number, pointerId: number) {
    const originTime = xToTime(originX);
    let didMove = false;
    let lastStart = originTime;
    let lastEnd = originTime;
    setAnnotationDragPreview({ start: originTime, end: originTime });
    function onMove(e: PointerEvent) {
      if (e.pointerId !== pointerId) return;
      if (Math.abs(e.clientX - originX) > DRAG_THRESHOLD_PX) didMove = true;
      const t = xToTime(e.clientX);
      lastStart = Math.min(originTime, t);
      lastEnd = Math.max(originTime, t);
      setAnnotationDragPreview({ start: lastStart, end: lastEnd });
    }
    function onUp(e: PointerEvent) {
      if (e.pointerId !== pointerId) return;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      setAnnotationDragPreview(null);
      const startMs = Math.round((didMove ? lastStart : originTime) * 1000);
      const endMs = didMove
        ? Math.max(startMs + 1, Math.round(lastEnd * 1000))
        : null;
      onAnnotationCreated(startMs, endMs);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }


  function onLoopPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!duration || !loop) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const handle = target.closest('.loop-handle') as HTMLElement | null;
    const mode: DragMode = handle
      ? handle.dataset.handle === 'left'
        ? 'resize-left'
        : 'resize-right'
      : 'move';
    startDrag(
      {
        mode,
        originX: e.clientX,
        originTime: 0,
        originStart: loop.start,
        originEnd: loop.end,
        didMove: false,
        lastStart: null,
        lastEnd: null,
      },
      e.pointerId,
    );
    e.stopPropagation();
    e.preventDefault();
  }

  const wr = getWaveRect();
  const playheadLeft = duration
    ? wr.left + (Math.min(currentTime, duration) / duration) * wr.width
    : 0;
  const loopLeft = loop && duration ? wr.left + (loop.start / duration) * wr.width : 0;
  const loopWidth = loop && duration ? ((loop.end - loop.start) / duration) * wr.width : 0;
  const annotationPreviewLeft =
    annotationDragPreview && duration
      ? wr.left + (annotationDragPreview.start / duration) * wr.width
      : 0;
  const annotationPreviewWidth =
    annotationDragPreview && duration
      ? Math.max(
          2,
          ((annotationDragPreview.end - annotationDragPreview.start) /
            duration) *
            wr.width,
        )
      : 0;

  // Effective mute: if any stem is soloed, non-soloed are muted.
  const anySolo = stems.some((s) => s.soloed);

  return (
    <main
      className={
        'player' +
        (railCollapsed ? ' rail-collapsed' : '') +
        (annotationCreateMode ? ' annotating' : '')
      }
    >
      <div className="player-header">
        <div>
          <div className="player-meta">Practice</div>
          <div className="player-title">{title}</div>
          {driveFolderId ? (
            <a
              className="drive-link"
              href={`https://drive.google.com/drive/folders/${encodeURIComponent(driveFolderId)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Drive ↗
            </a>
          ) : null}
        </div>
        <div className="player-header-right">
          <label className="master-vol" title={`Master ${masterVolume}% (${VOLUME_UNITY}% = unity, ${VOLUME_MAX}% = +12 dB)`}>
            <span className="player-meta">Master</span>
            <input
              className={'vol-slider master' + (masterVolume > VOLUME_UNITY ? ' boosted' : '')}
              type="range"
              min={0}
              max={VOLUME_MAX}
              step={1}
              value={masterVolume}
              onChange={(e) => player.setMasterVolume(parseInt(e.target.value, 10))}
              onDoubleClick={() => player.setMasterVolume(VOLUME_UNITY)}
            />
            <span className="vol-num master">{masterVolume}</span>
          </label>
          <div className="player-meta">
            {stems.length ? `${stems.length} stems · ${fmt(duration)}` : ''}
          </div>
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
        <button
          type="button"
          className={'tbtn norm' + (waveformNormalization === 'global' ? ' on' : '')}
          title={
            waveformNormalization === 'per-track'
              ? 'Waveform scale: per-track (each row fills its waveform). Click for global.'
              : 'Waveform scale: global (heights reflect relative loudness). Click for per-track.'
          }
          aria-pressed={waveformNormalization === 'global'}
          onClick={() => player.toggleWaveformNormalization()}
        >
          {waveformNormalization === 'per-track' ? (
            // Three equal bars — each row fills its waveform.
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <rect x="3" y="3" width="2" height="10" fill="currentColor" />
              <rect x="7" y="3" width="2" height="10" fill="currentColor" />
              <rect x="11" y="3" width="2" height="10" fill="currentColor" />
            </svg>
          ) : (
            // Three bars of different heights — shared scale shows relative loudness.
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <rect x="3" y="3" width="2" height="10" fill="currentColor" />
              <rect x="7" y="6" width="2" height="4" fill="currentColor" />
              <rect x="11" y="4" width="2" height="8" fill="currentColor" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className={'tbtn rail-toggle' + (railCollapsed ? ' collapsed' : '')}
          title={railCollapsed ? 'Show track controls' : 'Hide track controls'}
          aria-label={railCollapsed ? 'Show track controls' : 'Hide track controls'}
          aria-pressed={railCollapsed}
          onClick={() => setRailCollapsed((v) => !v)}
        >
          {railCollapsed ? '◨' : '◧'}
        </button>
        {canCreateAnnotations && (
          <button
            type="button"
            className={
              'tbtn annotation-add' + (annotationCreateMode ? ' on' : '')
            }
            title={
              annotationCreateMode
                ? 'Click ruler for point, drag for region. Click again to cancel.'
                : 'Add annotation: click ruler for point, drag for region'
            }
            aria-pressed={annotationCreateMode}
            disabled={!stems.length}
            onClick={onToggleAnnotationCreate}
          >
            +
          </button>
        )}
        <button
          type="button"
          className={'tbtn annotations-toggle' + (annotationsOpen ? ' on' : '')}
          title="Toggle annotations panel"
          aria-pressed={annotationsOpen}
          onClick={onToggleAnnotations}
        >
          ✎
        </button>
        <span className="ttime">
          {fmt(currentTime)} / {fmt(duration)}
        </span>
      </div>

      {annotationCreateMode && (
        <div className="annotation-mode-banner" role="status">
          <span className="annotation-mode-dot" aria-hidden="true" />
          <strong>Annotation mode</strong> &middot; click the timeline for a
          point, drag for a region &middot; <kbd>Esc</kbd> or click + to cancel
          <button
            type="button"
            className="annotation-mode-cancel"
            onClick={onToggleAnnotationCreate}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="stage" ref={stageRef}>
        {annotationCreateMode && duration > 0 && (
          <div
            className="annotation-create-overlay"
            style={{ left: `${wr.left}px`, width: `${wr.width}px` }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              startAnnotationDrag(e.clientX, e.pointerId);
              e.preventDefault();
            }}
            aria-label="Click for point annotation, drag for region"
          />
        )}
        <Ruler duration={duration} onPointerDown={onRulerPointerDown} rulerRef={rulerRef} />
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
              waveformNormalization={waveformNormalization}
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
          onPointerDown={onLoopPointerDown}
        />
        <AnnotationMarkers
          annotations={annotations}
          duration={duration}
          userColorMap={userColorMap}
          visible={markersVisible}
          waveLeftPx={wr.left}
          waveWidthPx={wr.width}
          onSelect={onAnnotationSelected}
        />
        {annotationDragPreview && (
          <div
            className="annotation-drag-preview"
            style={{
              left: `${annotationPreviewLeft}px`,
              width: `${annotationPreviewWidth}px`,
            }}
            aria-hidden="true"
          />
        )}
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
