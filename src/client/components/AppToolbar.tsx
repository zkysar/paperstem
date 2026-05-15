import { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  Maximize2,
  MessageSquarePlus,
  Pause,
  Play,
  Repeat,
  Share2,
  SkipBack,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { fmt } from '../lib/format';
import { VOLUME_MAX, VOLUME_UNITY } from '../lib/audio';
import type { ViewportControls } from '../hooks/useViewport';
import { ToolbarOverflowMenu } from './ToolbarOverflowMenu';

type Props = {
  hasProject: boolean;
  isPlaying: boolean;
  loopEnabled: boolean;
  /**
   * The loop button has been clicked but no region has been dragged out yet,
   * so the *next* ruler drag will create a region. Lights the same as
   * `loopEnabled` (the visual state is "loop is active"), but the tooltip
   * needs to distinguish so it can say "drag the timeline" rather than
   * pretending playback is repeating something.
   */
  loopArmed?: boolean;
  waveformNormalization: 'per-track' | 'global';
  masterVolume: number;
  currentTime: number;
  duration: number;
  annotationCreateMode: boolean;
  canCreateAnnotations: boolean;
  sectionCreateMode: boolean;
  canCreateSections: boolean;
  markersVisible: boolean;
  railCollapsed: boolean;
  showRailToggle: boolean;
  isWide: boolean;
  onSeek(t: number): void;
  onTogglePlay(): void;
  onToggleLoopEnabled(): void;
  onToggleWaveformNormalization(): void;
  onToggleAnnotationCreate(): void;
  onToggleSectionCreate(): void;
  onToggleMarkersVisible(): void;
  onSetMasterVolume(v: number): void;
  onToggleRailCollapsed(): void;
  viewport: ViewportControls;
  onOpenShortcuts(): void;
  /**
   * Opens the share dialog seeded with the current player + UI state. The
   * dialog itself shows toggles for each piece of bundled state and owns
   * the clipboard write.
   */
  onShare(): void;
};

export function AppToolbar(props: Props) {
  const {
    hasProject, isPlaying, loopEnabled, loopArmed = false,
    waveformNormalization, masterVolume, currentTime, duration,
    annotationCreateMode, canCreateAnnotations,
    sectionCreateMode, canCreateSections,
    markersVisible,
    railCollapsed, showRailToggle, isWide,
    onSeek, onTogglePlay, onToggleLoopEnabled,
    onToggleWaveformNormalization, onToggleAnnotationCreate,
    onToggleSectionCreate,
    onToggleMarkersVisible, onSetMasterVolume, onToggleRailCollapsed,
    viewport, onOpenShortcuts,
    onShare,
  } = props;

  return (
    <div className="app-toolbar">
      <button type="button" className="atb-btn"
        aria-label="Restart"
        title="Jump back to the start"
        disabled={!hasProject}
        onClick={() => onSeek(0)}><SkipBack size={16} strokeWidth={2} fill="currentColor" aria-hidden="true" /></button>
      <button type="button" className={'atb-btn play' + (isPlaying ? ' on' : '')}
        aria-label="Play"
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        disabled={!hasProject}
        onClick={onTogglePlay}>
        {isPlaying
          ? <Pause size={16} strokeWidth={2} fill="currentColor" aria-hidden="true" />
          : <Play size={16} strokeWidth={2} fill="currentColor" aria-hidden="true" />}
      </button>
      <button type="button" className={'atb-btn' + (loopEnabled ? ' loop-on' : '')}
        aria-label="Toggle loop"
        title={loopArmed
          ? 'Loop armed — drag on the timeline to set the region. Click here again to cancel.'
          : loopEnabled
            ? 'Loop is on — playback repeats the selected region. Click to turn off.'
            : 'Loop — repeat a region of the song. Click here to arm, then drag on the timeline to set the region.'}
        disabled={!hasProject}
        onClick={onToggleLoopEnabled}><Repeat size={16} strokeWidth={2} aria-hidden="true" /></button>

      {isWide && (
        <span className="atb-time">
          {fmt(currentTime)} / {fmt(duration)}
        </span>
      )}

      <span className="atb-divider" />

      <div className="atb-share-wrap">
        <button type="button" className="atb-btn"
          aria-label="Share link"
          title="Share link — pick what to include (time, loop, mix, view, comment) before copying"
          disabled={!hasProject}
          onClick={onShare}>
          <Share2 size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <span className="atb-divider" />

      <button type="button"
        className={'atb-btn' + (annotationCreateMode ? ' annotate-on' : '')}
        aria-label="Add comment"
        aria-pressed={annotationCreateMode}
        disabled={!canCreateAnnotations}
        title={annotationCreateMode
          ? 'Cancel comment mode'
          : 'Add comment — click the timeline for a point, drag for a region'}
        onClick={onToggleAnnotationCreate}><MessageSquarePlus size={16} strokeWidth={2} aria-hidden="true" /></button>

      <button type="button"
        className={'atb-btn' + (sectionCreateMode ? ' annotate-on' : '')}
        aria-label="Add section"
        aria-pressed={sectionCreateMode}
        disabled={!canCreateSections}
        title={sectionCreateMode
          ? 'Cancel section mode (M)'
          : 'Add section — click the timeline to mark where a song begins (M)'}
        onClick={onToggleSectionCreate}><Bookmark size={16} strokeWidth={2} aria-hidden="true" /></button>

      <span className="atb-divider" />

      {isWide ? (
        <div className="toolbar-group">
          <button
            type="button"
            className="atb-btn"
            onClick={() => {
              const stage = document.querySelector('.stage') as HTMLDivElement | null;
              const sw = stage?.getBoundingClientRect().width ?? 800;
              viewport.zoomH('out', { stageWidth: sw, anchorX: sw / 2 });
            }}
            aria-label="Zoom out"
            title="Zoom out (⌘−)"
          >
            <ZoomOut size={14} aria-hidden="true" />
          </button>
          <span
            className="toolbar-readout"
            title={`Horizontal ${Math.round(viewport.state.hZoom * 100)}%, track ${viewport.state.trackHeight}px`}
          >
            {Math.round(viewport.state.hZoom * 100)}%
          </span>
          <button
            type="button"
            className="atb-btn"
            onClick={() => {
              const stage = document.querySelector('.stage') as HTMLDivElement | null;
              const sw = stage?.getBoundingClientRect().width ?? 800;
              viewport.zoomH('in', { stageWidth: sw, anchorX: sw / 2 });
            }}
            aria-label="Zoom in"
            title="Zoom in (⌘=)"
          >
            <ZoomIn size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="atb-btn"
            onClick={() => viewport.fitToWindow()}
            aria-label="Fit to window"
            title="Fit to window (⌘0)"
          >
            <Maximize2 size={14} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <MobileZoomPopover viewport={viewport} />
      )}

      <span className="atb-divider" />

      {isWide ? (
        <label className="atb-master">
          <span className="atb-master-label">Master</span>
          <input
            type="range"
            className={'atb-master-slider' + (masterVolume > VOLUME_UNITY ? ' boosted' : '')}
            min={0} max={VOLUME_MAX} step={1}
            value={masterVolume}
            onChange={(e) => onSetMasterVolume(parseInt(e.target.value, 10))}
            onDoubleClick={() => onSetMasterVolume(VOLUME_UNITY)}
            aria-label="Master volume"
          />
          <span className="atb-master-num">{masterVolume}</span>
        </label>
      ) : (
        <MasterVolumePopover
          masterVolume={masterVolume}
          onSetMasterVolume={onSetMasterVolume}
        />
      )}

      <ToolbarOverflowMenu
        waveformNormalization={waveformNormalization}
        markersVisible={markersVisible}
        railCollapsed={railCollapsed}
        showRailToggle={showRailToggle}
        onToggleWaveformNormalization={onToggleWaveformNormalization}
        onToggleMarkersVisible={onToggleMarkersVisible}
        onToggleRailCollapsed={onToggleRailCollapsed}
        onOpenShortcuts={onOpenShortcuts}
      />
    </div>
  );
}

function MasterVolumePopover({
  masterVolume,
  onSetMasterVolume,
}: {
  masterVolume: number;
  onSetMasterVolume(v: number): void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="atb-master-pop-wrap" ref={wrapRef}>
      <button
        type="button"
        className={'atb-btn' + (masterVolume > VOLUME_UNITY ? ' boosted' : '')}
        aria-label="Master volume"
        title="Master volume"
        aria-pressed={open}
        onClick={() => setOpen((v) => !v)}
      >
        {masterVolume === 0
          ? <VolumeX size={16} strokeWidth={2} aria-hidden="true" />
          : <Volume2 size={16} strokeWidth={2} aria-hidden="true" />}
      </button>
      {open && (
        <div className="atb-master-pop">
          <span className="atb-master-pop-label">Master Volume</span>
          <div className="atb-master-pop-row">
            <input
              type="range"
              className={masterVolume > VOLUME_UNITY ? 'boosted' : undefined}
              min={0} max={VOLUME_MAX} step={1}
              value={masterVolume}
              onChange={(e) => onSetMasterVolume(parseInt(e.target.value, 10))}
              onDoubleClick={() => onSetMasterVolume(VOLUME_UNITY)}
              aria-label="Master volume slider"
            />
            <span className="atb-master-pop-num">{masterVolume}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileZoomPopover({ viewport }: { viewport: ViewportControls }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function getStageWidth() {
    const stage = document.querySelector('.stage') as HTMLDivElement | null;
    return stage?.getBoundingClientRect().width ?? 800;
  }

  return (
    <div className="atb-zoom-pop-wrap" ref={wrapRef}>
      <button
        type="button"
        className="atb-btn"
        aria-label="Zoom"
        title="Zoom controls"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ZoomIn size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <div className="atb-zoom-pop" role="menu">
          <button
            type="button"
            className="atb-btn"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => {
              const sw = getStageWidth();
              viewport.zoomH('out', { stageWidth: sw, anchorX: sw / 2 });
            }}
          >
            <ZoomOut size={16} aria-hidden="true" />
          </button>
          <span className="atb-zoom-pop-pct">{Math.round(viewport.state.hZoom * 100)}%</span>
          <button
            type="button"
            className="atb-btn"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => {
              const sw = getStageWidth();
              viewport.zoomH('in', { stageWidth: sw, anchorX: sw / 2 });
            }}
          >
            <ZoomIn size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="atb-btn"
            aria-label="Fit to window"
            title="Fit the whole song to the window"
            onClick={() => viewport.fitToWindow()}
          >
            <Maximize2 size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
