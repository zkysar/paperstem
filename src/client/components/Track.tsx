import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import type { LoadedStem, WaveformNormalization } from '../data/types';
import { VOLUME_MAX, VOLUME_UNITY } from '../lib/audio';
import { mix } from '../lib/colors';

type Props = {
  stem: LoadedStem;
  idx: number;
  focused: boolean;
  effectiveMuted: boolean;
  durationRef: number; // total song length, for clip width
  waveformNormalization: WaveformNormalization;
  canMutate: boolean;
  onFocus(idx: number): void;
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
  focused,
  effectiveMuted,
  durationRef,
  waveformNormalization,
  canMutate,
  onFocus,
  onToggleMute,
  onToggleSolo,
  onSetVolume,
  onSeek,
  onRenameStem,
  onDeleteStem,
}: Props) {
  const clipRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  // Read latest normalization in the create-effect without re-mounting on toggle.
  const normRef = useRef(waveformNormalization);
  normRef.current = waveformNormalization;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stem.displayName);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
  // changes (i.e. a new practice loads).
  useEffect(() => {
    if (!clipRef.current) return;
    let ws: WaveSurfer | null = null;
    try {
      ws = WaveSurfer.create({
        container: clipRef.current,
        media: stem.audio,
        url: stem.audio.src,
        height: 28,
        waveColor: stem.color,
        progressColor: mix(stem.color, '#2a2723', 0.35),
        cursorColor: 'transparent',
        cursorWidth: 0,
        barWidth: 2,
        barGap: 1,
        barRadius: 0,
        normalize: normRef.current === 'per-track',
        interact: true,
      });
    } catch {
      return;
    }
    wsRef.current = ws;
    const off = ws.on('interaction', (t: number) => onSeek(t));
    const errOff = ws.on('error', () => {});
    return () => {
      off();
      errOff();
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

  const stemDuration = isFinite(stem.audio.duration) ? stem.audio.duration : durationRef;
  const widthPct = durationRef ? Math.max(1, Math.min(100, (stemDuration / durationRef) * 100)) : 100;

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest('.pill, .vol-slider, .clip, .track-name-input, .track-name-editable')) return;
    onFocus(idx);
  }

  return (
    <div className={'track' + (focused ? ' focused' : '')} onPointerDown={handlePointerDown}>
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
            <span
              className={'track-name' + (nameEditable ? ' track-name-editable' : '')}
              title={nameEditable ? 'Click to rename' : stem.displayName}
              onClick={() => {
                if (nameEditable) setEditing(true);
              }}
            >
              {stem.displayName}
            </span>
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
            🗑
          </button>
        </span>
      </div>
      <div className="wave">
        <div
          ref={clipRef}
          className={'clip' + (effectiveMuted ? ' muted' : '')}
          style={{ width: `${widthPct}%` }}
        />
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
              <button type="button" onClick={() => setConfirmDelete(false)}>
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
