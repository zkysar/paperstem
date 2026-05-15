import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EmojiPicker } from './EmojiPicker';

// Mock the lazy-loaded emoji-mart picker so the dialog renders synchronously.
vi.mock('@emoji-mart/react', () => ({
  default: () => <div data-testid="mart-picker">mart</div>,
}));
vi.mock('@emoji-mart/data', () => ({ default: {} }));

describe('EmojiPicker', () => {
  // The picker is rendered inside CommentPopover, which applies a CSS
  // transform. A transformed ancestor establishes a containing block for
  // position:fixed descendants, which breaks the picker's viewport-relative
  // positioning. Portaling to document.body escapes the transform.
  it('renders into document.body, escaping any transformed ancestor', () => {
    const { container } = render(
      <div style={{ transform: 'translateX(0)' }} data-testid="transformed">
        <EmojiPicker
          isNarrow={false}
          anchorRect={null}
          onSelect={() => {}}
          onClose={() => {}}
        />
      </div>,
    );

    const dialog = screen.getByRole('dialog', { name: /choose an emoji/i });
    const transformed = container.querySelector('[data-testid="transformed"]');
    expect(transformed).not.toBeNull();
    expect(transformed!.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });
});
