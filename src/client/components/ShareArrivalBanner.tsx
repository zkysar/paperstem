import { Play, X } from 'lucide-react';
import { fmt } from '../lib/format';

export type ShareArrivalCategory = 'loop' | 'mix' | 'stem' | 'comment';

type Props = {
  time: number | null;
  categories: ShareArrivalCategory[];
  onPlay: () => void;
  onDismiss: () => void;
};

const CATEGORY_LABELS: Record<ShareArrivalCategory, string> = {
  loop: 'Loop region',
  mix: 'Custom mix',
  stem: 'Focused stem',
  comment: 'Focused comment',
};

export function ShareArrivalBanner({ time, categories, onPlay, onDismiss }: Props) {
  const headline = time != null ? `Shared at ${fmt(time)}` : 'Shared link applied';
  return (
    <div className="share-arrival" role="status" aria-live="polite">
      <div className="share-arrival-text">
        <span className="share-arrival-headline">{headline}</span>
        {categories.length > 0 && (
          <span className="share-arrival-cats">
            {' · '}
            {categories.map((c) => CATEGORY_LABELS[c]).join(' · ')}
          </span>
        )}
      </div>
      <button
        type="button"
        className="share-arrival-play"
        onClick={onPlay}
      >
        <Play size={14} strokeWidth={2} fill="currentColor" aria-hidden="true" />
        <span>Listen</span>
      </button>
      <button
        type="button"
        className="share-arrival-dismiss"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
