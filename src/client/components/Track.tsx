import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, Trash2 } from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import type { LoadedStem, WaveformNormalization } from '../data/types';
import { VOLUME_MAX, VOLUME_UNITY } from '../lib/audio';
import { mix } from '../lib/colors';
import { computePeaks, encodePeaks, PLAYER_PEAK_BINS } from '../lib/peaks';

type Props = {
  stem: LoadedStem;
  idx: number;
  effectiveMuted: boolean;
  durationRef: number; // total song length, for clip width
  waveformNormalization: WaveformNormalization;
  canMutate: boolean;
  trackHeight: number;
  hZoom: number;
  onToggleMute(idx: number): void;
  onToggleSolo(idx: number): void;
  onSetVolume(idx: number, vol: number): void;
  onSeek(t: number): void;
  onRenameStem(serverId: string, name: string): void;
  onDeleteStem(serverId: string): void;
};

export function Track({
  stem,
  idx,
  effectiveMuted,
  durationRef,
  waveformNormalization,
  canMutate,
  trackHeight,
  hZoom,
  onToggleMute,
  onToggleSolo,
  onSetVolume,
  onSeek,
  onRenameStem,
  onDeleteStem,
}: Props) {
  const clipRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [waveLoading, setWaveLoading] = useState(true);
  // Read latest normalization in the create-effect without re-mounting on toggle.
  const normRef = useRef(waveformNormalization);
  normRef.current = waveformNormalization;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stem.displayName);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [unavailableHover, setUnavailableHover] = useState(false);
  const [unavailablePinned, setUnavailablePinned] = useState(false);
  const unavailableBtnRef = useRef<HTMLButtonElement>(null);
  const unavailablePopRef = useRef<HTMLDivElement>(null);
  const unavailablePopId = useId();
  const unavailableOpen = unavailableHover || unavailablePinned;

  // While the unavailable popover is pinned open, dismiss on outside click or Escape.
  useEffect(() => {
    if (!unavailablePinned) return;
    function onDocPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (unavailableBtnRef.current?.contains(t)) return;
      if (unavailablePopRef.current?.contains(t)) return;
      setUnavailablePinned(false);
      setUnavailableHover(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setUnavailablePinned(false);
        setUnavailableHover(false);
      }
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [unavailablePinned]);

  // Esc dismisses the delete-confirm modal when it's open.
  useEffect(() => {
    if (!confirmDelete) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setConfirmDelete(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmDelete]);

  // Watch the audio element for load failures (e.g. server returns 410 for a
  // ghost stem whose audio file was deleted out-of-band).
  useEffect(() => {
    function onErr() {
      setUnavailable(true);
    }
    setUnavailable(false);
    stem.audio.addEventListener('error', onErr);
    return () => {
      stem.audio.removeEventListener('error', onErr);
    };
  }, [stem.audio]);

  // Keep the draft in sync if the underlying displayName changes from outside
  // (e.g. an optimistic rename completing, or a different stem rendered into
  // the same Track slot).
  useEffect(() => {
    setDraft(stem.displayName);
  }, [stem.displayName]);

  const nameEditable = canMutate && stem.serverId !== null;
  const canDelete = canMutate && stem.serverId !== null;

  function commitRename() {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === stem.displayName) return;
    if (!stem.serverId) return;
    onRenameStem(stem.serverId, next);
  }

  function cancelRename() {
    setEditing(false);
    setDraft(stem.displayName);
  }

  // Attach WaveSurfer to the clip element. Re-creates when the audio element
  // changes (i.e. a new project loads).
  useEffect(() => {
    if (!clipRef.current) return;
    let ws: WaveSurfer | null = null;
    setWaveLoading(true);
    // When we have pre-computed peaks, hand them to WaveSurfer and skip the
    // audio decode entirely — the waveform renders immediately. Duration must
    // also be supplied; prefer the decoded AudioBuffer's duration since
    // mobile Safari may never fire `loadedmetadata` on the muted <audio>.
    const knownDuration = stem.audioBuffer?.duration ?? stem.audio.duration;
    const usePrecomputed =
      stem.peaks !== null && stem.peaks.length > 0 && isFinite(knownDuration);
    try {
      ws = WaveSurfer.create({
        container: clipRef.current,
        media: stem.audio,
        url: stem.audio.src,
        height: Math.max(8, trackHeight - 16),
        waveColor: stem.color,
        progressColor: mix(stem.color, '#2a2723', 0.35),
        cursorColor: 'transparent',
        cursorWidth: 0,
        barWidth: 2,
        barGap: 1,
        barRadius: 0,
        normalize: normRef.current === 'per-track',
        interact: true,
        ...(usePrecomputed
          ? { peaks: [stem.peaks as number[]], duration: knownDuration }
          : {}),
      });
    } catch {
      return;
    }
    wsRef.current = ws;
    const off = ws.on('interaction', (t: number) => onSeek(t));
    const errOff = ws.on('error', () => setUnavailable(true));
    // Wait for initial render + a frame so the layout-settle redraw happens
    // before we fade the waveform in. Avoids the "jump to fit" flash.
    let raf = 0;
    const wsRefForReady = ws;
    const sidForBackfill = stem.serverId;
    const needsBackfill = !usePrecomputed && sidForBackfill !== null;
    const readyOff = ws.on('ready', () => {
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => setWaveLoading(false));
      });
      // Opportunistic backfill: if this stem had no pre-computed peaks, the
      // browser just decoded the audio anyway — grab the resulting buffer,
      // compute the same peaks format we ship at upload, and PUT it to the
      // server so the next viewer (and future loads here) skip the decode.
      // Fire-and-forget; failures are silent.
      if (!needsBackfill) return;
      try {
        const decoded = wsRefForReady.getDecodedData();
        if (!decoded) return;
        const peaks = computePeaks(decoded, PLAYER_PEAK_BINS);
        const encoded = encodePeaks(peaks);
        void fetch(`/api/stems/${encodeURIComponent(sidForBackfill)}/peaks`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peaks: encoded }),
        }).catch(() => {});
      } catch {
        // ignore
      }
    });
    return () => {
      off();
      errOff();
      readyOff();
      if (raf) cancelAnimationFrame(raf);
      try {
        ws?.destroy();
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, [stem.audio, stem.color, onSeek]);

  // Toggle normalize on the existing instance — re-renders without re-decoding audio.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    try {
      ws.setOptions({ normalize: waveformNormalization === 'per-track' });
    } catch {
      // ignore
    }
  }, [waveformNormalization]);

  // Sync wave height when the viewport's track height changes.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    try {
      ws.setOptions({ height: Math.max(8, trackHeight - 16) });
    } catch {
      // ignore
    }
  }, [trackHeight]);

  // Hide-and-fade across BIG container resizes (e.g., comments panel toggling
  // the rail-annotations column — a single ~300px jump). WaveSurfer auto-
  // redraws on resize; we hide synchronously so the snap isn't visible, then
  // fade back in once width is stable. Zoom-driven resizes are excluded so the
  // waveform stays visible during continuous zoom gestures — we detect them by
  // noticing hZoom changed since the previous fire.
  const hZoomRef = useRef(hZoom);
  hZoomRef.current = hZoom;
  useEffect(() => {
    const el = clipRef.current;
    if (!el) return;
    let lastWidth = el.getBoundingClientRect().width;
    let lastHZoom = hZoomRef.current;
    let firstFire = true;
    let fadeTimer: number | null = null;
    const RESIZE_THRESHOLD_PX = 100;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? lastWidth;
      const zoomChanged = hZoomRef.current !== lastHZoom;
      lastHZoom = hZoomRef.current;
      if (firstFire) {
        firstFire = false;
        lastWidth = w;
        return;
      }
      const delta = Math.abs(w - lastWidth);
      lastWidth = w;
      if (zoomChanged) return;
      if (delta < RESIZE_THRESHOLD_PX) return;
      setWaveLoading(true);
      if (fadeTimer) clearTimeout(fadeTimer);
      fadeTimer = window.setTimeout(() => {
        setWaveLoading(false);
        fadeTimer = null;
      }, 220);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (fadeTimer) clearTimeout(fadeTimer);
    };
  }, []);

  const stemDur = stem.audioBuffer?.duration ?? stem.audio.duration;
  const stemDuration = isFinite(stemDur) ? stemDur : durationRef;
  const widthPct = durationRef ? Math.max(1, Math.min(100, (stemDuration / durationRef) * 100)) : 100;

  const tierClass =
    trackHeight < 32 ? 'tier-min'
    : trackHeight < 44 ? 'tier-mid'
    : 'tier-full';

  return (
    <div className={'track ' + tierClass}>
      {unavailable ? (
        <div className="track-rail track-rail-unavailable">
          <span className="swatch swatch-muted" />
          <div className="track-info">
            <span className="track-name muted" title={stem.displayName}>
              {stem.displayName}
            </span>
          </div>
          <span className="ms-pills">
            <span
              className="unavailable-anchor"
              onPointerEnter={() => setUnavailableHover(true)}
              onPointerLeave={() => setUnavailableHover(false)}
            >
              <button
                ref={unavailableBtnRef}
                type="button"
                className="pill unavailable-icon"
                aria-label="Stem unavailable — the audio file is missing"
                aria-expanded={unavailableOpen}
                aria-describedby={unavailableOpen ? unavailablePopId : undefined}
                onClick={() => setUnavailablePinned((p) => !p)}
              >
                <AlertCircle size={14} strokeWidth={2} aria-hidden="true" />
              </button>
              {unavailableOpen && (
                <div
                  ref={unavailablePopRef}
                  id={unavailablePopId}
                  role="tooltip"
                  className="unavailable-popover"
                >
                  Stem unavailable. The audio file is missing.
                </div>
              )}
            </span>
            <button
              type="button"
              className="pill trash"
              aria-label={`Move ${stem.displayName} to trash`}
              onClick={() => {
                if (canDelete) setConfirmDelete(true);
              }}
              disabled={!canDelete}
              title="Move to trash"
            >
              <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </span>
        </div>
      ) : (
        <div className="track-rail">
          <span className="swatch" style={{ background: stem.color }} title={stem.displayName} />
          <div className="track-info">
            {editing && nameEditable ? (
              <input
                className="track-name-input"
                aria-label="Rename stem"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelRename();
                  }
                }}
                onBlur={commitRename}
              />
            ) : (
              <button
                type="button"
                className={'track-name' + (nameEditable ? ' track-name-editable' : '')}
                title={nameEditable ? 'Click to rename' : stem.displayName}
                onClick={() => {
                  if (nameEditable) setEditing(true);
                }}
                disabled={!nameEditable}
              >
                {stem.displayName}
              </button>
            )}
            <span className="vol-row">
              <input
                className={'vol-slider' + (stem.userVolume > VOLUME_UNITY ? ' boosted' : '')}
                type="range"
                min={0}
                max={VOLUME_MAX}
                step={1}
                value={stem.userVolume}
                onChange={(e) => onSetVolume(idx, parseInt(e.target.value, 10))}
                title={`${stem.userVolume}% (${VOLUME_UNITY}% = unity, ${VOLUME_MAX}% = +12 dB)`}
                aria-label={`${stem.displayName} volume`}
                onDoubleClick={() => onSetVolume(idx, VOLUME_UNITY)}
              />
              <span className="vol-num">{stem.userVolume}</span>
            </span>
          </div>
          <span className="ms-pills">
            <button
              type="button"
              className={'pill mute' + (stem.userMuted ? ' on' : '')}
              onClick={() => onToggleMute(idx)}
            >
              M
            </button>
            <button
              type="button"
              className={'pill solo' + (stem.soloed ? ' on' : '')}
              onClick={() => onToggleSolo(idx)}
            >
              S
            </button>
            <button
              type="button"
              className="pill trash"
              aria-label={`Move ${stem.displayName} to trash`}
              onClick={() => {
                if (canDelete) setConfirmDelete(true);
              }}
              disabled={!canDelete}
              title="Move to trash"
            >
              <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </span>
        </div>
      )}
      <div className="wave">
        {unavailable ? (
          <div className="wave-unavailable" style={{ width: `${widthPct}%` }} />
        ) : (
          <div
            ref={clipRef}
            className={'clip' + (effectiveMuted ? ' muted' : '') + (waveLoading ? ' loading' : '')}
            style={{ width: `${widthPct}%` }}
          />
        )}
      </div>
      {confirmDelete && (
        <div
          className="fp-modal-scrim"
          role="presentation"
          onClick={() => setConfirmDelete(false)}
        >
          <div
            className="fp-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Move "{stem.displayName}" to trash?</h3>
            <p>You can restore from this band's trash for 30 days.</p>
            <div className="fp-modal-actions">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  if (stem.serverId) onDeleteStem(stem.serverId);
                  setConfirmDelete(false);
                }}
              >
                Move to trash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
