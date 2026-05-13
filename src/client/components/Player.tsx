import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Annotation } from '../../shared/types';
import type { PlayerControls } from '../hooks/usePlayer';
import { pixelToTime } from '../lib/format';
import { AnnotationMarkers } from './AnnotationMarkers';
import { LoopRegion } from './LoopRegion';
import { Playhead } from './Playhead';
import { Ruler } from './Ruler';
import { Track } from './Track';
import { DEFAULT_TRACK_H } from '../hooks/useViewport';

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
  annotations: Annotation[];
  userColorMap: Map<string, string>;
  markersVisible: boolean;
  annotationCreateMode: boolean;
  onAnnotationCreated(start_ms: number, end_ms: number | null): void;
  onAnnotationSelected(annotation: Annotation): void;
  pendingDraft: { start_ms: number; end_ms: number | null } | null;
  hoveredAnnotationId: string | null;
  onHoverAnnotation: Dispatch<SetStateAction<string | null>>;
  onLoopAnnotation(annotation: Annotation): void;
  // Controlled rail-collapse state (lifted to App so AppToolbar's rail-toggle
  // button can drive it). The breakpoint listener also lives in App.
  railCollapsed: boolean;
  canMutate: boolean;
  onToggleAnnotationCreate(): void;
  onOpenPicker(): void;
  onRenameStem(serverId: string, name: string): void;
  onDeleteStem(serverId: string): void;
};

export function Player({
  player,
  annotations,
  userColorMap,
  markersVisible,
  annotationCreateMode,
  onAnnotationCreated,
  onAnnotationSelected,
  pendingDraft,
  hoveredAnnotationId,
  onHoverAnnotation,
  onLoopAnnotation,
  railCollapsed,
  canMutate,
  onToggleAnnotationCreate,
  onOpenPicker,
  onRenameStem,
  onDeleteStem,
}: Props) {
  const { state, currentTime } = player;
  const {
    stems,
    duration,
    loop,
    focusedIdx,
    status,
    loading,
    waveformNormalization,
  } = state;

  const stageRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);

  // Wave area geometry: re-measured on each render so overlay positions
  // (playhead, loop region, annotation markers) follow size changes. A
  // ResizeObserver on the stage catches every layout source — window resize,
  // the track-name rail collapsing, the annotations rail opening (which
  // shrinks the player via the .app-body grid), etc. — without needing each
  // parent state to be threaded in as a prop.
  const [, forceRender] = useState(0);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(() => forceRender((n) => n + 1));
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);
  // ResizeObserver fires async after layout, so the first render under a new
  // `railCollapsed` className still uses pre-commit DOM. Re-measure
  // synchronously so the overlay snaps in place rather than drifting for one
  // frame after the toggle.
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
  const previewSource = (() => {
    if (!duration) return null;
    if (annotationDragPreview) {
      return {
        startMs: annotationDragPreview.start * 1000,
        endMs: annotationDragPreview.end * 1000,
        isPoint: false,
      };
    }
    if (pendingDraft) {
      return {
        startMs: pendingDraft.start_ms,
        endMs: pendingDraft.end_ms ?? pendingDraft.start_ms,
        isPoint: pendingDraft.end_ms === null,
      };
    }
    return null;
  })();
  const previewLeft = previewSource && duration
    ? wr.left + (previewSource.startMs / 1000 / duration) * wr.width
    : 0;
  const previewWidth = previewSource && duration
    ? Math.max(
        previewSource.isPoint ? 3 : 2,
        ((previewSource.endMs - previewSource.startMs) / 1000 / duration) * wr.width,
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
          {!stems.length && !loading && (
            <div className="empty-stage">
              <p>No practice loaded.</p>
              <button
                type="button"
                className="empty-stage-cta"
                onClick={onOpenPicker}
              >
                Open the file picker (⌘K)
              </button>
            </div>
          )}
          {!stems.length && loading && (
            <>
              {loading.displayNames.map((name, i) => (
                <div className="track track-skeleton" key={`skel-${i}`} aria-hidden="true">
                  <div className="track-rail">
                    <span className="swatch" style={{ background: loading.colors[i] }} />
                    <div className="track-info">
                      <span className="track-name" title={name}>{name}</span>
                    </div>
                  </div>
                  <div className="wave">
                    <div className="clip wave-skel" />
                  </div>
                </div>
              ))}
              <div className="player-loading-overlay" role="status" aria-live="polite">
                <div className="player-loading-card">
                  <div className="player-loading-title">
                    Loading {loading.displayNames.length} stem{loading.displayNames.length === 1 ? '' : 's'}
                  </div>
                  <div className="player-loading-progress">
                    <div
                      className="player-loading-bar"
                      style={{
                        width: `${(loading.loaded / Math.max(1, loading.displayNames.length)) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="player-loading-count">
                    {loading.loaded} / {loading.displayNames.length}
                  </div>
                </div>
              </div>
            </>
          )}
          {stems.map((stem, i) => (
            <Track
              key={stem.serverId ?? `${stem.practiceId ?? 'local'}-${stem.name}`}
              stem={stem}
              idx={i}
              focused={i === focusedIdx}
              effectiveMuted={anySolo ? !stem.soloed : stem.userMuted}
              durationRef={duration}
              waveformNormalization={waveformNormalization}
              canMutate={canMutate}
              trackHeight={DEFAULT_TRACK_H}
              onFocus={player.focusStem}
              onToggleMute={player.toggleMute}
              onToggleSolo={player.toggleSolo}
              onSetVolume={player.setVolume}
              onSeek={player.seek}
              onRenameStem={onRenameStem}
              onDeleteStem={onDeleteStem}
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
          hoveredId={hoveredAnnotationId}
          onHover={onHoverAnnotation}
          onLoopAnnotation={onLoopAnnotation}
          createMode={annotationCreateMode}
        />
        {previewSource && (
          <div
            className={
              'annotation-drag-preview' +
              (previewSource.isPoint ? ' point' : '') +
              (annotationDragPreview ? ' dragging' : ' pending')
            }
            style={{
              left: `${previewLeft}px`,
              width: `${previewWidth}px`,
            }}
            aria-hidden="true"
          />
        )}
        <Playhead visible={!!stems.length && !!duration} leftPx={playheadLeft} />
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

      <div className="status">{status}</div>

      <div className="keys-hint">
        <strong>Keys:</strong> <kbd>Space</kbd> play/pause &middot; <kbd>L</kbd> loop on/off
        &middot; <kbd>Esc</kbd> clear loop &middot; <kbd>M</kbd>/<kbd>S</kbd> mute/solo focused
        track &middot; drag the ruler to set a loop region
      </div>
    </main>
  );
}
