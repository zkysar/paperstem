import { Star } from 'lucide-react';

type Props = {
  count: number;
  starredCount: number;
  onClick(): void;
};

export function CommentsFab({ count, starredCount, onClick }: Props) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      className="comments-fab"
      onClick={onClick}
      aria-label={`All comments · ${count}`}
      title="Open the comments panel — see notes left on the timeline by you and your bandmates"
    >
      {starredCount > 0 && (
        <span className="comments-fab-star">
          <Star size={12} strokeWidth={2} fill="currentColor" aria-hidden="true" /> {starredCount}
        </span>
      )}
      <span className="comments-fab-label">All comments</span>
      <span className="comments-fab-count">{count}</span>
    </button>
  );
}
