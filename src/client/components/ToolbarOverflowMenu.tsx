import { useEffect, useRef, useState } from 'react';
import {
  AudioWaveform,
  Eye,
  EyeOff,
  HelpCircle,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';

type Props = {
  waveformNormalization: 'per-track' | 'global';
  markersVisible: boolean;
  railCollapsed: boolean;
  showRailToggle: boolean;
  onToggleWaveformNormalization(): void;
  onToggleMarkersVisible(): void;
  onToggleRailCollapsed(): void;
  onOpenShortcuts(): void;
};

export function ToolbarOverflowMenu(props: Props) {
  const {
    waveformNormalization,
    markersVisible,
    railCollapsed,
    showRailToggle,
    onToggleWaveformNormalization,
    onToggleMarkersVisible,
    onToggleRailCollapsed,
    onOpenShortcuts,
  } = props;
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

  function run(handler: () => void) {
    return () => {
      handler();
      setOpen(false);
    };
  }

  return (
    <div className="atb-overflow-wrap" ref={wrapRef}>
      <button
        type="button"
        className="atb-btn"
        aria-label="More options"
        title="More options (waveform, markers, shortcuts)"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <div className="atb-overflow-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={run(onToggleWaveformNormalization)}
          >
            <AudioWaveform size={14} strokeWidth={2} aria-hidden="true" />
            Waveform: {waveformNormalization === 'global' ? 'Global' : 'Per-track'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(onToggleMarkersVisible)}
          >
            {markersVisible
              ? <Eye size={14} strokeWidth={2} aria-hidden="true" />
              : <EyeOff size={14} strokeWidth={2} aria-hidden="true" />}
            Markers: {markersVisible ? 'Visible' : 'Hidden'}
          </button>
          {showRailToggle && (
            <button
              type="button"
              role="menuitem"
              onClick={run(onToggleRailCollapsed)}
            >
              {railCollapsed
                ? <PanelRightOpen size={14} strokeWidth={2} aria-hidden="true" />
                : <PanelRightClose size={14} strokeWidth={2} aria-hidden="true" />}
              {railCollapsed ? 'Show' : 'Hide'} track controls
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={run(onOpenShortcuts)}
          >
            <HelpCircle size={14} strokeWidth={2} aria-hidden="true" />
            Keyboard shortcuts
          </button>
        </div>
      )}
    </div>
  );
}
