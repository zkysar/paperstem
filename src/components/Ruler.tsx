import { useRef } from 'react';
import { fmt } from '../lib/format';

type Props = {
  duration: number;
  onPointerDown(e: React.PointerEvent<HTMLDivElement>): void;
  rulerRef: React.RefObject<HTMLDivElement | null>;
};

const TICK_PCTS = [0, 0.25, 0.5, 0.75, 1] as const;

export function Ruler({ duration, onPointerDown, rulerRef }: Props) {
  const localRef = useRef<HTMLDivElement>(null);
  const ref = rulerRef ?? localRef;
  return (
    <div className="ruler-row">
      <div className="ruler" ref={ref} onPointerDown={onPointerDown}>
        {TICK_PCTS.map((p, i) => {
          const style: React.CSSProperties =
            p === 0 ? { left: 0 } : p === 1 ? { right: 0 } : { left: `${p * 100}%` };
          return (
            <span
              key={`l${i}`}
              className="ruler-label"
              data-pos={p}
              style={style}
            >
              {fmt(duration * p)}
            </span>
          );
        })}
        {TICK_PCTS.filter((p) => p > 0 && p < 1).map((p, i) => (
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
