import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Repeat } from 'lucide-react';
import type { Annotation } from '../../shared/types';
import { fmt } from '../lib/format';

type Props = {
  annotation: Annotation;
  color: string;
  anchorLeftPx: number;
  anchorTopPx: number;
  onLoopRegion(): void;
};

export function AnnotationHoverCard({
  annotation,
  color,
  anchorLeftPx,
  anchorTopPx,
  onLoopRegion,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<'above' | 'below'>('above');
  const [translateX, setTranslateX] = useState(0);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 8) setPlacement('below');
    else setPlacement('above');
    const margin = 8;
    if (r.left < margin) setTranslateX(margin - r.left);
    else if (r.right > window.innerWidth - margin)
      setTranslateX(window.innerWidth - margin - r.right);
    else setTranslateX(0);
  }, [anchorLeftPx, anchorTopPx]);

  const author = annotation.user_display_name ?? annotation.user_email;
  const timeText =
    annotation.end_ms === null
      ? fmt(annotation.start_ms / 1000)
      : `${fmt(annotation.start_ms / 1000)} – ${fmt(annotation.end_ms / 1000)}`;
  const isRegion = annotation.end_ms !== null;

  const style: CSSProperties = {
    left: `${anchorLeftPx}px`,
    top: `${anchorTopPx}px`,
    transform: `translateX(calc(-50% + ${translateX}px))${
      placement === 'below'
        ? ' translateY(8px)'
        : ' translateY(-100%) translateY(-8px)'
    }`,
  };

  return (
    <div
      ref={cardRef}
      className={'annotation-hover-card placement-' + placement}
      style={style}
      role="tooltip"
    >
      <div className="ahc-meta">
        <span className="ahc-avatar" style={{ background: color }}>
          {author.slice(0, 2).toUpperCase()}
        </span>
        <span className="ahc-author">{author}</span>
        <span className="ahc-time">
          {timeText}
          {isRegion && (
            <button
              type="button"
              className="ahc-loop"
              onClick={(e) => {
                e.stopPropagation();
                onLoopRegion();
              }}
              title="Loop region"
              aria-label="Loop region"
            >
              <Repeat size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </span>
      </div>
      <div className="ahc-body">{annotation.body}</div>
    </div>
  );
}
