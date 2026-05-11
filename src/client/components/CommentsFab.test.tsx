import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { CommentsFab } from './CommentsFab';

describe('CommentsFab', () => {
  it('renders count and label', () => {
    render(<CommentsFab count={3} starredCount={1} onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /all comments/i })).not.toBeNull();
    expect(screen.getByText('3')).not.toBeNull();
    expect(screen.getByText(/★ 1/)).not.toBeNull();
  });

  it('renders nothing when count is 0', () => {
    const { container } = render(
      <CommentsFab count={0} starredCount={0} onClick={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    render(<CommentsFab count={2} starredCount={0} onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
