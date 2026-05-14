import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { CommentPopover } from './CommentPopover';
import type { Annotation } from '../../shared/types';

const region: Annotation = {
  id: 'a1',
  project_id: 'p1',
  user_id: 'u1',
  user_email: 'sam@example.com',
  user_display_name: 'Sam',
  start_ms: 1000,
  end_ms: 3000,
  body: 'first thought',
  starred: false,
  created_at: 0,
  updated_at: 0,
};

const baseProps = {
  annotation: region,
  color: '#c17446',
  anchorLeftPx: 100,
  anchorTopPx: 100,
  canEdit: true,
  isOwn: true,
  onLoopRegion: vi.fn(),
  onToggleStar: vi.fn(),
  onSaveEdit: vi.fn(),
  onDelete: vi.fn(),
  onCopyLink: vi.fn().mockResolvedValue({ ok: true, categories: [] }),
  onClose: vi.fn(),
};

describe('CommentPopover', () => {
  it('renders author, time, and body', () => {
    render(<CommentPopover {...baseProps} />);
    expect(screen.getByText('Sam')).not.toBeNull();
    expect(screen.getByText('first thought')).not.toBeNull();
    expect(screen.getByText(/0:01/)).not.toBeNull();
  });

  it('clicking star calls onToggleStar', async () => {
    const onToggleStar = vi.fn();
    render(<CommentPopover {...baseProps} onToggleStar={onToggleStar} />);
    await userEvent.click(screen.getByLabelText(/star/i));
    expect(onToggleStar).toHaveBeenCalledOnce();
  });

  it('region annotation shows loop button', () => {
    render(<CommentPopover {...baseProps} />);
    expect(screen.getByLabelText(/loop region/i)).not.toBeNull();
  });

  it('point annotation hides loop button', () => {
    render(
      <CommentPopover
        {...baseProps}
        annotation={{ ...region, end_ms: null }}
      />,
    );
    expect(screen.queryByLabelText(/loop region/i)).toBeNull();
  });

  it('clicking edit switches to textarea, save calls onSaveEdit', async () => {
    const onSaveEdit = vi.fn();
    const user = userEvent.setup();
    render(<CommentPopover {...baseProps} onSaveEdit={onSaveEdit} />);
    await user.click(screen.getByLabelText('Edit'));
    const ta = screen.getByRole('textbox');
    await user.clear(ta);
    await user.type(ta, 'updated');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(onSaveEdit).toHaveBeenCalledWith('updated');
  });

  it('clicking delete (confirmed) calls onDelete', async () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CommentPopover {...baseProps} onDelete={onDelete} />);
    await userEvent.click(screen.getByLabelText('Delete'));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('non-owner does not see edit/delete', () => {
    render(<CommentPopover {...baseProps} isOwn={false} />);
    expect(screen.queryByLabelText('Edit')).toBeNull();
    expect(screen.queryByLabelText('Delete')).toBeNull();
  });

  it('copy-link click shows a "Link copied — includes X" toast next to the button', async () => {
    const user = userEvent.setup();
    const onCopyLink = vi.fn().mockResolvedValue({ ok: true, categories: ['loop', 'view'] });
    render(<CommentPopover {...baseProps} onCopyLink={onCopyLink} />);
    await user.click(screen.getByLabelText('Copy link to this comment'));
    expect(onCopyLink).toHaveBeenCalledOnce();
    const toast = await screen.findByRole('status');
    expect(toast.textContent).toMatch(/Link copied — includes loop, view/);
  });

  it('copy-link toast shows "Link copied" when no extra state is included', async () => {
    const user = userEvent.setup();
    const onCopyLink = vi.fn().mockResolvedValue({ ok: true, categories: [] });
    render(<CommentPopover {...baseProps} onCopyLink={onCopyLink} />);
    await user.click(screen.getByLabelText('Copy link to this comment'));
    const toast = await screen.findByRole('status');
    expect(toast.textContent).toBe('Link copied');
  });
});
