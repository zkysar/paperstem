import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { CommentBottomSheet } from './CommentBottomSheet';
import type { Annotation } from '../../shared/types';

const ann: Annotation = {
  id: 'a1', practice_id: 'p1', user_id: 'u1',
  user_email: 'sam@example.com', user_display_name: 'Sam',
  start_ms: 1000, end_ms: null, body: 'note', starred: false,
  created_at: 0, updated_at: 0,
};

const baseProps = {
  annotation: ann, color: '#c17446',
  canEdit: true, isOwn: true,
  index: 0, total: 3,
  onPrev: vi.fn(), onNext: vi.fn(),
  onLoopRegion: vi.fn(), onToggleStar: vi.fn(),
  onSaveEdit: vi.fn(), onDelete: vi.fn(), onClose: vi.fn(),
};

describe('CommentBottomSheet', () => {
  it('renders 1/3 counter and body', () => {
    render(<CommentBottomSheet {...baseProps} />);
    expect(screen.getByText('1 / 3')).not.toBeNull();
    expect(screen.getByText('note')).not.toBeNull();
  });

  it('prev button calls onPrev', async () => {
    const onPrev = vi.fn();
    render(<CommentBottomSheet {...baseProps} index={1} onPrev={onPrev} />);
    await userEvent.click(screen.getByLabelText(/previous/i));
    expect(onPrev).toHaveBeenCalledOnce();
  });

  it('next button calls onNext', async () => {
    const onNext = vi.fn();
    render(<CommentBottomSheet {...baseProps} onNext={onNext} />);
    await userEvent.click(screen.getByLabelText(/next/i));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('prev disabled when index is 0', () => {
    render(<CommentBottomSheet {...baseProps} index={0} />);
    expect(
      (screen.getByLabelText(/previous/i) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('next disabled when at end', () => {
    render(<CommentBottomSheet {...baseProps} index={2} total={3} />);
    expect(
      (screen.getByLabelText(/next/i) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
