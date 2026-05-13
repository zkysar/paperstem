import { useEffect, useRef, useState } from 'react';
import {
  AudioWaveform,
  Download,
  Eye,
  EyeOff,
  HelpCircle,
  Loader2,
  Map as MapIcon,
  Maximize2,
  MessageSquarePlus,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Repeat,
  SkipBack,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { fmt } from '../lib/format';
import { VOLUME_MAX, VOLUME_UNITY } from '../lib/audio';
import type { ViewportControls } from '../hooks/useViewport';

type Props = {
  hasPractice: boolean;
  isPlaying: boolean;
  hasLoop: boolean;
  loopEnabled: boolean;
  downloading: boolean;
  waveformNormalization: 'per-track' | 'global';
  masterVolume: number;
  currentTime: number;
  duration: number;
  annotationCreateMode: boolean;
  canCreateAnnotations: boolean;
  markersVisible: boolean;
  railCollapsed: boolean;
  showRailToggle: boolean;
  isWide: boolean;
  onSeek(t: number): void;
  onTogglePlay(): void;
  onToggleLoopEnabled(): void;
  onDownloadAll(): void;
  onToggleWaveformNormalization(): void;
  onToggleAnnotationCreate(): void;
  onToggleMarkersVisible(): void;
  onSetMasterVolume(v: number): void;
  onToggleRailCollapsed(): void;
  viewport: ViewportControls;
  onOpenShortcuts(): void;
};

export function AppToolbar(props: Props) {
  const {
    hasPractice, isPlaying, hasLoop, loopEnabled, downloading,
    waveformNormalization, masterVolume, currentTime, duration,
    annotationCreateMode, canCreateAnnotations, markersVisible,
    railCollapsed, showRailToggle, isWide,
    onSeek, onTogglePlay, onToggleLoopEnabled, onDownloadAll,
    onToggleWaveformNormalization, onToggleAnnotationCreate,
    onToggleMarkersVisible, onSetMasterVolume, onToggleRailCollapsed,
    viewport, onOpenShortcuts,
  } = props;

  return (
    <div className="app-toolbar">
      <button type="button" className="atb-btn"
        aria-label="Restart"
        disabled={!hasPractice}
        onClick={() => onSeek(0)}><SkipBack size={16} strokeWidth={2} fill="currentColor" aria-hidden="true" /></button>
      <button type="button" className={'atb-btn play' + (isPlaying ? ' on' : '')}
        aria-label="Play"
        disabled={!hasPractice}
        onClick={onTogglePlay}>
        {isPlaying
          ? <Pause size={16} strokeWidth={2} fill="currentColor" aria-hidden="true" />
          : <Play size={16} strokeWidth={2} fill="currentColor" aria-hidden="true" />}
      </button>
      <button type="button" className={'atb-btn' + (loopEnabled ? ' loop-on' : '')}
        aria-label="Toggle loop"
        disabled={!hasLoop}
        onClick={onToggleLoopEnabled}><Repeat size={16} strokeWidth={2} aria-hidden="true" /></button>

      <span className="atb-divider" />

      <button type="button" className="atb-btn"
        aria-label="Download all stems"
        disabled={!hasPractice || downloading}
        onClick={onDownloadAll}>
        {downloading
          ? <Loader2 size={16} strokeWidth={2} className="atb-spin" aria-hidden="true" />
          : <Download size={16} strokeWidth={2} aria-hidden="true" />}
      </button>
      <button type="button" className={'atb-btn' + (waveformNormalization === 'global' ? ' on' : '')}
        aria-label="Toggle waveform scale"
        aria-pressed={waveformNormalization === 'global'}
        onClick={onToggleWaveformNormalization}><AudioWaveform size={16} strokeWidth={2} aria-hidden="true" /></button>

      <span className="atb-divider" />

      <button type="button"
        className={'atb-btn' + (annotationCreateMode ? ' annotate-on' : '')}
        aria-label="Add annotation"
        aria-pressed={annotationCreateMode}
        disabled={!canCreateAnnotations}
        onClick={onToggleAnnotationCreate}><MessageSquarePlus size={16} strokeWidth={2} aria-hidden="true" /></button>
      <button type="button"
        className={'atb-btn' + (markersVisible ? ' on' : '')}
        aria-label="Toggle marker visibility"
        aria-pressed={markersVisible}
        onClick={onToggleMarkersVisible}>
        {markersVisible
          ? <Eye size={16} strokeWidth={2} aria-hidden="true" />
          : <EyeOff size={16} strokeWidth={2} aria-hidden="true" />}
      </button>

      {showRailToggle && (
        <>
          <span className="atb-divider" />
          <button type="button"
            className={'atb-btn' + (railCollapsed ? ' on' : '')}
            aria-label={railCollapsed ? 'Show track controls' : 'Hide track controls'}
            aria-pressed={railCollapsed}
            onClick={onToggleRailCollapsed}>
            {railCollapsed
              ? <PanelRightOpen size={16} strokeWidth={2} aria-hidden="true" />
              : <PanelRightClose size={16} strokeWidth={2} aria-hidden="true" />}
          </button>
        </>
      )}

      <span className="atb-divider" />

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
        <button
          type="button"
          className={'atb-btn' + (viewport.state.minimapPref === 'off' ? ' off' : '')}
          onClick={() =>
            viewport.setMinimapPref(viewport.state.minimapPref === 'auto' ? 'off' : 'auto')
          }
          aria-label={viewport.state.minimapPref === 'auto' ? 'Hide minimap' : 'Show minimap (auto)'}
          title={viewport.state.minimapPref === 'auto' ? 'Minimap: auto (click to hide)' : 'Minimap: off (click to enable auto)'}
        >
          <MapIcon size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="atb-btn"
          onClick={onOpenShortcuts}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
        >
          <HelpCircle size={14} aria-hidden="true" />
        </button>
      </div>

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

      <span className="atb-time">
        {fmt(currentTime)} / {fmt(duration)}
      </span>
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
