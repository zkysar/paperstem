import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Reactions } from './Reactions';

vi.mock('./EmojiPicker', () => ({
  EmojiPicker: ({ onSelect }: { onSelect(e: string): void }) => (
    <button aria-label="mock-picker" onClick={() => onSelect('🎵')}>
      pick
    </button>
  ),
}));

describe('Reactions', () => {
  it('renders one pill per emoji with count', () => {
    render(
      <Reactions
        reactions={[
          { emoji: '👍', count: 2, user_ids: ['u', 'v'], reacted_by_self: true },
          { emoji: '🎵', count: 1, user_ids: ['v'], reacted_by_self: false },
        ]}
        isNarrow={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /Remove 👍/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /React with 🎵/i })).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('marks self-reactions with aria-pressed', () => {
    render(
      <Reactions
        reactions={[
          { emoji: '👍', count: 1, user_ids: ['u'], reacted_by_self: true },
        ]}
        isNarrow={false}
        onToggle={() => {}}
      />,
    );
    const pill = screen.getByRole('button', { name: /Remove 👍/i });
    expect(pill.getAttribute('aria-pressed')).toBe('true');
  });

  it('calls onToggle when a pill is clicked', () => {
    const onToggle = vi.fn();
    render(
      <Reactions
        reactions={[
          { emoji: '👍', count: 1, user_ids: ['u'], reacted_by_self: false },
        ]}
        isNarrow={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /React with 👍/i }));
    expect(onToggle).toHaveBeenCalledWith('👍');
  });

  it('opens picker and calls onToggle on selection', () => {
    const onToggle = vi.fn();
    render(
      <Reactions reactions={[]} isNarrow={false} onToggle={onToggle} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Add reaction/i }));
    fireEvent.click(screen.getByRole('button', { name: /mock-picker/i }));
    expect(onToggle).toHaveBeenCalledWith('🎵');
  });
});
