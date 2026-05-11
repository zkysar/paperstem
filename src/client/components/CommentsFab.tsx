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
    >
      {starredCount > 0 && (
        <span className="comments-fab-star">★ {starredCount}</span>
      )}
      <span className="comments-fab-label">All comments</span>
      <span className="comments-fab-count">{count}</span>
    </button>
  );
}
