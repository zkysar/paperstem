import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Annotation, Section } from '../../shared/types';
import type { PlayerControls } from '../hooks/usePlayer';
import { useIsMobile } from '../hooks/useIsMobile';
import { pixelToTime } from '../lib/format';
import { attachPinchZoom } from '../lib/touch-pinch';
import { AnnotationMarkers } from './AnnotationMarkers';
import { FollowPill } from './FollowPill';
import { LoopRegion } from './LoopRegion';
import { Minimap } from './Minimap';
import { Playhead } from './Playhead';
import { Ruler } from './Ruler';
import { SectionLane } from './SectionLane';
import { ActiveSectionChip } from './ActiveSectionChip';
import { Track } from './Track';
import type { ViewportControls } from '../hooks/useViewport';

const DRAG_THRESHOLD_PX = 4;
const MIN_LOOP_SEC = 0.05;

type DragMode = 'scrub' | 'create' | 'move' | 'resize-left' | 'resize-right';

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
  // Section lane + creation state. The lane shows song boundaries above
  // the ruler; clicking a pill seeks. Creation mode opens a popover at
  // the click point on the wave area (driven by App.tsx).
  sections: Section[];
  songUseCounts: Map<string, number>;
  activeSectionId: string | null;
  sectionCreateMode: boolean;
  onSectionSelected(section: Section): void;
  onPatchSection(id: string, input: { start_ms: number }): Promise<void>;
  onPatchAnnotation(
    id: string,
    input: { start_ms: number; end_ms: number | null },
  ): Promise<void>;
  selfUserId: string;
  onSectionCreated(start_ms: number, clientX: number, clientY: number): void;
  onToggleSectionCreate(): void;
  // Controlled rail-collapse state (lifted to App so AppToolbar's rail-toggle
  // button can drive it). The breakpoint listener also lives in App.
  railCollapsed: boolean;
  canMutate: boolean;
  onToggleAnnotationCreate(): void;
  onOpenPicker(): void;
  onRenameStem(serverId: string, name: string): void;
  onDeleteStem(serverId: string): void;
  viewport: ViewportControls;
  onDismissPopovers?: () => void;
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
  sections,
  songUseCounts,
  activeSectionId,
  sectionCreateMode,
  onSectionSelected,
  onPatchSection,
  onPatchAnnotation,
  selfUserId,
  onSectionCreated,
  onToggleSectionCreate,
  railCollapsed,
  canMutate,
  onToggleAnnotationCreate,
  onOpenPicker,
  onRenameStem,
  onDeleteStem,
  viewport,
  onDismissPopovers,
}: Props) {
  const { state, currentTime } = player;
  const {
    stems,
    duration,
    loop,
    loopArmed,
    status,
    loading,
    waveformNormalization,
  } = state;

  const isMobile = useIsMobile();

  const stageRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Wave area geometry: re-measured on each render so overlay positions
  // (playhead, loop region, annotation markers) follow size changes. A
  // ResizeObserver on the stage catches every layout source — window resize,
  // the track-name rail collapsing, the annotations rail opening (which
  // shrinks the player via the .app-body grid), etc. — without needing each
  // parent state to be threaded in as a prop.
  const [, forceRender] = useState(0);

  const [laneHovered, setLaneHovered] = useState(false);
  const [laneTappedOpen, setLaneTappedOpen] = useState(false);

  const laneExpanded =
    laneHovered ||
    (isMobile && laneTappedOpen) ||
    sectionCreateMode;

  useEffect(() => {
    if (!laneTappedOpen) return;
    const handler = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target && target.closest('.section-lane-wrap')) return;
      setLaneTappedOpen(false);
    };
    document.addEventListener('pointerdown', handler, { capture: true });
    return () =>
      document.removeEventListener('pointerdown', handler, { capture: true });
  }, [laneTappedOpen]);

  useEffect(() => {
    if (sections.length === 0) {
      setLaneHovered(false);
      setLaneTappedOpen(false);
    }
  }, [sections.length]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(() => {
      forceRender((n) => n + 1);
      const s = stageRef.current;
      if (s) viewport.setStageWidth(s.getBoundingClientRect().width);
    });
    ro.observe(stage);
    viewport.setStageWidth(stage.getBoundingClientRect().width);
    // Also watch the ruler: when the tracks area gets a scrollbar (or loses
    // one), .stage's outer width is unchanged but the wave column inside it
    // shrinks, so overlay positions need to re-measure off the ruler's rect.
    const ruler = rulerRef.current;
    if (ruler) ro.observe(ruler);
    return () => ro.disconnect();
  }, [viewport]);
  // ResizeObserver fires async after layout, so the first render under a new
  // `railCollapsed` className still uses pre-commit DOM. Re-measure
  // synchronously so the overlay snaps in place rather than drifting for one
  // frame after the toggle.
  useLayoutEffect(() => {
    forceRender((n) => n + 1);
  }, [railCollapsed]);

  // Keep the DOM scrollLeft in sync with viewport state when something other
  // than user-scroll changed it (e.g. zoom anchor math, fit-to-window).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (Math.abs(el.scrollLeft - viewport.state.scrollLeft) > 0.5) {
      el.scrollLeft = viewport.state.scrollLeft;
    }
  }, [viewport.state.scrollLeft]);

  // Non-passive wheel listener for ⌥-scroll (horizontal zoom) and
  // ⇧-scroll (horizontal pan). We attach via addEventListener — React's
  // synthetic onWheel is passive-by-default and can't preventDefault.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (e.altKey && e.shiftKey) {
        // ⌥⇧+scroll → vertical zoom (track height). Same deltaY→factor curve
        // as horizontal zoom for consistent gesture feel.
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0025);
        viewport.zoomVBy(factor);
      } else if (e.altKey) {
        e.preventDefault();
        const stage = stageRef.current;
        if (!stage) return;
        const stageRect = stage.getBoundingClientRect();
        const anchorX = e.clientX - stageRect.left;
        // Scale the zoom factor by deltaY magnitude. A trackpad can fire 30+
        // wheel events per gesture; a fixed-step multiplier compounds way
        // too fast. With factor = exp(-deltaY * 0.0025), a full gesture
        // (cumulative deltaY ≈ -300) reaches ~2.1× zoom, not 17×. Keyboard
        // shortcuts still use the larger ZOOM_FACTOR (1.5×) via zoomH().
        const factor = Math.exp(-e.deltaY * 0.0025);
        viewport.zoomHBy(factor, {
          stageWidth: stageRect.width,
          anchorX,
        });
        // Manual zoom suspends auto-follow.
        if (viewport.state.followActive) viewport.setFollowActive(false);
      } else if (e.ctrlKey) {
        // Trackpad two-finger pinch. Chromium/Firefox synthesize wheel
        // events with ctrlKey=true during a pinch gesture, even when no
        // ctrl key is physically held. Without this branch the browser
        // does its native full-page zoom on pinch.
        e.preventDefault();
        const stage = stageRef.current;
        if (!stage) return;
        const stageRect = stage.getBoundingClientRect();
        const anchorX = e.clientX - stageRect.left;
        const factor = Math.exp(-e.deltaY * 0.0025);
        viewport.zoomHBy(factor, {
          stageWidth: stageRect.width,
          anchorX,
        });
        if (viewport.state.followActive) viewport.setFollowActive(false);
      } else if (e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        // Shift converts vertical wheel to horizontal pan.
        e.preventDefault();
        const target = el.scrollLeft + e.deltaY;
        viewport.setScrollLeft(target, el.scrollWidth - el.clientWidth);
        if (viewport.state.followActive) viewport.setFollowActive(false);
      }
      // Otherwise let the browser handle: native vertical scroll on the
      // viewport (when tracks overflow vertically), and native horizontal
      // pan (trackpad two-finger swipe → e.deltaX without shift).
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewport]);

  // Touchscreen pinch-zoom (iOS / iPad gesture events, with TouchEvent
  // fallback for Android). Without this, Safari does its native page
  // zoom on a two-finger pinch over the timeline.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    return attachPinchZoom(el, ({ scaleDelta, clientX }) => {
      const stage = stageRef.current;
      if (!stage) return;
      const stageRect = stage.getBoundingClientRect();
      const anchorX = clientX - stageRect.left;
      viewport.zoomHBy(scaleDelta, { stageWidth: stageRect.width, anchorX });
      if (viewport.state.followActive) viewport.setFollowActive(false);
    });
  }, [viewport]);

  // When playback transitions from paused → playing, re-engage follow. The
  // user's mental model is that hitting play should bring the playhead back
  // into view, even if a prior zoom/scroll gesture suspended follow. We
  // only trigger on the rising edge — playing→paused must NOT toggle it
  // back off (the user may have paused to inspect something off-screen).
  const wasPlayingRef = useRef(player.state.isPlaying);
  useEffect(() => {
    const playing = player.state.isPlaying;
    if (playing && !wasPlayingRef.current) {
      viewport.setFollowActive(true);
    }
    wasPlayingRef.current = playing;
  }, [player.state.isPlaying, viewport]);

  // Keep a ref of the live player state so the rAF tick reads isPlaying
  // without depending on `player` in its effect deps (which would tear
  // down and rebuild the rAF loop on every play/pause).
  const playerStateRef = useRef(player.state);
  playerStateRef.current = player.state;

  // Smooth/page-flip follow. Runs only while playing and followActive.
  useEffect(() => {
    if (!viewport.state.followActive) return;
    if (!player.state.stems.length || !duration) return;

    let raf = 0;
    function tick() {
      const inner = viewportRef.current;
      const stage = stageRef.current;
      if (!inner || !stage) {
        raf = requestAnimationFrame(tick);
        return;
      }
      // Only follow while audio is actually playing — pausing freezes follow.
      // Read state via ref so the closure sees the current value without
      // having to re-create the effect every play/pause transition.
      if (!playerStateRef.current.isPlaying) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const w = stage.getBoundingClientRect().width;
      const rail = railCollapsed ? 0 : 260;
      const wave = Math.max(0, w * viewport.state.hZoom - rail);
      const waveVisibleW = Math.max(0, w - rail);
      const t = player.currentTime;
      // playheadInner mirrors the render formula (rail offset + wave fraction);
      // this is the .viewport-inner-relative x where the playhead is drawn.
      const playheadInner = duration ? rail + (t / duration) * wave : 0;
      const sl = inner.scrollLeft;
      const visibleR = sl + w;
      if (viewport.state.followMode === 'smooth') {
        // Keep the playhead ~25% into the visible wave area (past the rail).
        const target = Math.max(0, playheadInner - rail - waveVisibleW * 0.25);
        if (Math.abs(target - sl) > 0.5) {
          inner.scrollLeft = target;
        }
      } else {
        // page-flip: jump only when playhead crosses the right edge
        if (playheadInner > visibleR - 10) {
          inner.scrollLeft = Math.max(0, playheadInner - rail - waveVisibleW * 0.05);
        }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [viewport.state.followActive, viewport.state.followMode, viewport.state.hZoom, duration, player, railCollapsed]);

  function getStageInnerWidth(): number {
    const stage = stageRef.current;
    if (!stage) return 0;
    return stage.getBoundingClientRect().width;
  }
  const stageWidth = getStageInnerWidth();
  const innerWidth = stageWidth * viewport.state.hZoom;

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
      if (cur.mode === 'scrub') {
        player.seek(Math.max(0, Math.min(duration, t)));
        return;
      } else if (cur.mode === 'create') {
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
    onDismissPopovers?.();
    const t = xToTime(e.clientX);
    // When looping is off (no region, region disabled, and not armed), a
    // drag on the ruler scrubs the playhead. Loop creation needs either an
    // active region or the loop button armed — explicit, no accidents.
    const mode: DragMode = loop?.enabled || loopArmed ? 'create' : 'scrub';
    startDrag(
      {
        mode,
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

  // Overlays (playhead, loop region, annotation markers, annotation preview)
  // live INSIDE .viewport-inner, so their `left` is measured from the inner
  // content's left edge. The grid puts the rail in column 1 (railWidth px)
  // and the wave in column 2 (waveWidth px). Overlays must offset by
  // railWidth so they don't extend under the sticky rail / track names.
  // When the rail is collapsed (mobile), railWidth = 0 and the wave fills
  // the full row.
  const railWidth = railCollapsed ? 0 : 260; // matches --rail-w in app.css
  const waveWidth = Math.max(0, innerWidth - railWidth);
  // Mirror railWidth into viewport state so share-link snapshot/apply can read
  // it without re-deriving from railCollapsed.
  useEffect(() => {
    viewport.setRailWidth(railWidth);
  }, [railWidth, viewport]);
  // Playhead uses the same linear t → x mapping as the loop region,
  // annotation markers, and minimap. Z-index (5) places it above the
  // sticky rail (3), so the 1px line stays visible at t=0 even though
  // it overlaps the rail's right-edge box-shadow.
  //
  // The 1px line is painted in pixel column `left`. The wave column occupies
  // visible columns [railWidth, railWidth + waveWidth − 1]; column
  // `railWidth + waveWidth` is the first column past .viewport-inner's right
  // edge, where .viewport's overflow-x: hidden clips it. Cap the right edge
  // by one pixel so the line stays visible at t = duration (or when dragged
  // all the way to the end). t = 0 maps to railWidth (already visible), so
  // no left-edge cap is needed.
  const maxPlayheadLeft = railWidth + Math.max(0, waveWidth - 1);
  const playheadLeft = duration
    ? Math.min(
        maxPlayheadLeft,
        railWidth + (Math.min(currentTime, duration) / duration) * waveWidth,
      )
    : 0;
  const loopLeft = loop && duration ? railWidth + (loop.start / duration) * waveWidth : 0;
  const loopWidth = loop && duration ? ((loop.end - loop.start) / duration) * waveWidth : 0;
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
    ? railWidth + (previewSource.startMs / 1000 / duration) * waveWidth
    : 0;
  const previewWidth = previewSource && duration
    ? Math.max(
        previewSource.isPoint ? 3 : 2,
        ((previewSource.endMs - previewSource.startMs) / 1000 / duration) * waveWidth,
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
        {/* Minimap is always rendered (no toolbar toggle). The viewport rect
            is full-width and visually subtle at hZoom=1; once you zoom in,
            it shows the visible window and you can drag/click to pan. */}
        <Minimap
          duration={duration}
          hZoom={viewport.state.hZoom}
          scrollLeft={viewport.state.scrollLeft}
          viewportWidth={stageWidth}
          innerWidth={innerWidth}
          waveWidth={waveWidth}
          visibleWaveWidth={Math.max(0, stageWidth - railWidth)}
          annotations={annotations}
          loop={loop}
          currentTime={currentTime}
          userColorMap={userColorMap}
          onSeek={player.seek}
          onScrollTo={(px) => viewport.setScrollLeft(px, innerWidth - stageWidth)}
        />
        <div
          className="viewport"
          ref={viewportRef}
          style={{
            // At zoom=1 the inner content is exactly the viewport width, but
            // sub-pixel rounding can still trigger a stray horizontal
            // scrollbar. Hide it when there's nothing to scroll to.
            overflowX: viewport.state.hZoom > 1 ? 'auto' : 'hidden',
          }}
          onScroll={(e) => {
            const sl = (e.currentTarget as HTMLDivElement).scrollLeft;
            if (sl !== viewport.state.scrollLeft) {
              viewport.setScrollLeft(sl);
            }
          }}
        >
          <div
            className="viewport-inner"
            style={{
              width: viewport.state.hZoom > 1 ? `${innerWidth}px` : '100%',
              '--track-h': `${viewport.state.trackHeight}px`,
            } as React.CSSProperties}
          >
            {/* Pinned to the top-left of the viewport to mask any overlay
                (loop region, annotation marker region) whose left edge
                extends into the rail column at the ruler band. Lives
                outside .ruler-row so it can stack above sibling overlays
                — .ruler-row's sticky-induced stacking context traps its
                own spacer below them. */}
            <div className="ruler-rail-mask" aria-hidden="true" />
            {annotationCreateMode && duration > 0 && (
              <div
                className="annotation-create-overlay"
                style={{ left: `${railWidth}px`, width: `${waveWidth}px` }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  startAnnotationDrag(e.clientX, e.pointerId);
                  e.preventDefault();
                }}
                aria-label="Click for a point comment, drag for a region comment"
              />
            )}
            {sectionCreateMode && duration > 0 && (
              <div
                className="annotation-create-overlay"
                style={{ left: `${railWidth}px`, width: `${waveWidth}px` }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  const t = xToTime(e.clientX);
                  onSectionCreated(
                    Math.max(0, Math.round(t * 1000)),
                    e.clientX,
                    e.clientY,
                  );
                  e.preventDefault();
                }}
                aria-label="Click the timeline to drop a section at that time"
              />
            )}
            <div className="tracks" ref={tracksRef}>
              <Ruler
                duration={duration}
                onPointerDown={onRulerPointerDown}
                rulerRef={rulerRef}
                railSpacerSlot={
                  <ActiveSectionChip
                    sections={sections}
                    songUseCounts={songUseCounts}
                    currentTimeSeconds={currentTime}
                    onSeek={player.seek}
                  />
                }
              />
              <SectionLane
                sections={sections}
                duration={duration}
                waveLeftPx={railWidth}
                waveWidthPx={waveWidth}
                songUseCounts={songUseCounts}
                activeSectionId={activeSectionId}
                expanded={laneExpanded}
                interactionDisabled={annotationCreateMode}
                onSelect={onSectionSelected}
                onPatchSection={canMutate ? onPatchSection : undefined}
                onSeek={player.seek}
                onHoverChange={setLaneHovered}
                onTapToExpand={() => setLaneTappedOpen(true)}
              />
              {!stems.length && !loading && (
                <div className="empty-stage">
                  <p>No project loaded.</p>
                  <button
                    type="button"
                    className="empty-stage-cta"
                    onClick={onOpenPicker}
                  >
                    {isMobile ? 'Open the project picker' : 'Open the project picker (⌘K)'}
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
                  key={stem.serverId ?? `${stem.projectId ?? 'local'}-${stem.name}`}
                  stem={stem}
                  idx={i}
                  effectiveMuted={anySolo ? !stem.soloed : stem.userMuted}
                  durationRef={duration}
                  waveformNormalization={waveformNormalization}
                  canMutate={canMutate}
                  trackHeight={viewport.state.trackHeight}
                  hZoom={viewport.state.hZoom}
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
              waveLeftPx={railWidth}
              waveWidthPx={waveWidth}
              onSelect={onAnnotationSelected}
              hoveredId={hoveredAnnotationId}
              onHover={onHoverAnnotation}
              onLoopAnnotation={onLoopAnnotation}
              createMode={annotationCreateMode}
              selfUserId={selfUserId}
              onPatchAnnotation={onPatchAnnotation}
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
            {/* Hide the playhead when it would draw inside the sticky-rail
                column. The rail occupies screen-x [0, railWidth]; in
                .viewport-inner coords that's [scrollLeft, scrollLeft +
                railWidth]. Without this guard the playhead (z:5) would
                draw on top of the track names. */}
            <Playhead
              visible={
                !!stems.length &&
                !!duration &&
                playheadLeft >= viewport.state.scrollLeft + railWidth
              }
              leftPx={playheadLeft}
              clientXToLeftPx={(clientX) => {
                if (!duration) return 0;
                const t = xToTime(clientX);
                return Math.min(
                  maxPlayheadLeft,
                  railWidth + (t / duration) * waveWidth,
                );
              }}
              clientXToTime={xToTime}
              onSeek={player.seek}
            />
          </div>
        </div>
      </div>

      {annotationCreateMode && (
        <div className="annotation-mode-banner" role="status">
          <span className="annotation-mode-dot" aria-hidden="true" />
          <strong className="annotation-mode-title">Comment mode</strong>
          <span className="annotation-mode-chip">
            <span className="annotation-mode-glyph annotation-mode-glyph-point" aria-hidden="true" />
            <span><strong>Click</strong> for a point</span>
          </span>
          <span className="annotation-mode-chip">
            <span className="annotation-mode-glyph annotation-mode-glyph-region" aria-hidden="true" />
            <span><strong>Drag</strong> for a region</span>
          </span>
          <span className="annotation-mode-esc">
            <kbd>Esc</kbd> or <kbd>+</kbd> to cancel
          </span>
          <button
            type="button"
            className="annotation-mode-cancel"
            onClick={onToggleAnnotationCreate}
          >
            Cancel
          </button>
        </div>
      )}

      {sectionCreateMode && (
        <div className="annotation-mode-banner" role="status">
          <span className="annotation-mode-dot" aria-hidden="true" />
          <strong className="annotation-mode-title">Section mode</strong>
          <span className="annotation-mode-chip">
            <span className="annotation-mode-glyph annotation-mode-glyph-point" aria-hidden="true" />
            <span><strong>Click</strong> the timeline where a song starts</span>
          </span>
          <span className="annotation-mode-esc">
            <kbd>Esc</kbd> or <kbd>M</kbd> to cancel
          </span>
          <button
            type="button"
            className="annotation-mode-cancel"
            onClick={onToggleSectionCreate}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="status-row">
        <div className="status">{status}</div>
        {viewport.state.hZoom > 1 && (
          <FollowPill
            active={viewport.state.followActive}
            onToggle={() => viewport.setFollowActive(!viewport.state.followActive)}
          />
        )}
      </div>

      <div className="keys-hint">
        Press <kbd>?</kbd> for keyboard shortcuts.
      </div>
    </main>
  );
}
