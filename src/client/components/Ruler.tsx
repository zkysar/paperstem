import { useRef } from 'react';
import { fmt } from '../lib/format';

type Props = {
  duration: number;
  onPointerDown(e: React.PointerEvent<HTMLDivElement>): void;
  rulerRef: React.RefObject<HTMLDivElement | null>;
};

const INNER_TICK_PCTS = [0.25, 0.5, 0.75] as const;

export function Ruler({ duration, onPointerDown, rulerRef }: Props) {
  const localRef = useRef<HTMLDivElement>(null);
  const ref = rulerRef ?? localRef;
  return (
    <div className="ruler-row">
      <div className="ruler-rail-spacer" aria-hidden="true" />
      <div className="ruler" ref={ref} onPointerDown={onPointerDown}>
        <span className="ruler-label" data-pos={0} style={{ left: 0 }}>
          {fmt(0)}
        </span>
        <span className="ruler-label" data-pos={1} style={{ right: 0 }}>
          {fmt(duration)}
        </span>
        {INNER_TICK_PCTS.map((p, i) => (
          <span
            key={`t${i}`}
            className="ruler-tick"
            data-pos={p}
            style={{ left: `${p * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}
