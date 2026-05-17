import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Reaction } from '../../shared/types';
import { EmojiPicker } from './EmojiPicker';

type Props = {
  reactions: Reaction[];
  isNarrow: boolean;
  onToggle(emoji: string): void;
  // When false, the "+" picker affordance is hidden (public-link viewers
  // can't open the emoji picker). Existing reaction pills stay visible
  // so the count is readable; clicking them still calls onToggle.
  canReact?: boolean;
};

export function Reactions({
  reactions,
  isNarrow,
  onToggle,
  canReact = true,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  function openPicker() {
    setAnchorRect(addRef.current?.getBoundingClientRect() ?? null);
    setPickerOpen(true);
  }

  return (
    <div className="reactions-row">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          className={'reaction-pill' + (r.reacted_by_self ? ' self' : '')}
          aria-pressed={r.reacted_by_self}
          aria-label={
            r.reacted_by_self
              ? `Remove ${r.emoji} reaction`
              : `React with ${r.emoji}`
          }
          onClick={(e) => {
            e.stopPropagation();
            onToggle(r.emoji);
          }}
        >
          <span aria-hidden="true">{r.emoji}</span>
          <span className="reaction-count">{r.count}</span>
        </button>
      ))}
      {canReact && (
        <button
          ref={addRef}
          type="button"
          className="reaction-add"
          aria-label="Add reaction"
          onClick={(e) => {
            e.stopPropagation();
            openPicker();
          }}
        >
          <Plus size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
      {canReact && pickerOpen && (
        <EmojiPicker
          isNarrow={isNarrow}
          anchorRect={anchorRect}
          onSelect={(emoji) => onToggle(emoji)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
