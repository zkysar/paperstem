import { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import type { LoadedStem } from '../data/types';
import { mix } from '../lib/colors';

type Props = {
  stem: LoadedStem;
  idx: number;
  focused: boolean;
  effectiveMuted: boolean;
  durationRef: number; // total song length, for clip width
  onFocus(idx: number): void;
  onToggleMute(idx: number): void;
  onToggleSolo(idx: number): void;
  onSetVolume(idx: number, vol: number): void;
  onSeek(t: number): void;
};

export function Track({
  stem,
  idx,
  focused,
  effectiveMuted,
  durationRef,
  onFocus,
  onToggleMute,
  onToggleSolo,
  onSetVolume,
  onSeek,
}: Props) {
  const clipRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

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
        normalize: true,
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

  const stemDuration = isFinite(stem.audio.duration) ? stem.audio.duration : durationRef;
  const widthPct = durationRef ? Math.max(1, Math.min(100, (stemDuration / durationRef) * 100)) : 100;

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest('.pill, .vol-slider, .clip')) return;
    onFocus(idx);
  }

  return (
    <div className={'track' + (focused ? ' focused' : '')} onMouseDown={handleMouseDown}>
      <div className="track-rail">
        <span className="swatch" style={{ background: stem.color }} />
        <div className="track-info">
          <span className="track-name" title={stem.displayName}>
            {stem.displayName}
          </span>
          <span className="vol-row">
            <input
              className="vol-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={stem.userVolume}
              onChange={(e) => onSetVolume(idx, parseInt(e.target.value, 10))}
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
        </span>
      </div>
      <div className="wave">
        <div
          ref={clipRef}
          className={'clip' + (effectiveMuted ? ' muted' : '')}
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}
