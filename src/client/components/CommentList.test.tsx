import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { CommentList } from './CommentList';
import type { Annotation } from '../../shared/types';

function ann(over: Partial<Annotation>): Annotation {
  return {
    id: 'x', practice_id: 'p1', user_id: 'u1',
    user_email: 'u@example.com', user_display_name: 'Sam',
    start_ms: 0, end_ms: null, body: 'b',
    starred: false, created_at: 0, updated_at: 0,
    ...over,
  };
}

const annotations: Annotation[] = [
  ann({ id: '1', user_id: 'u1', user_display_name: 'Sam', body: 'mine 1' }),
  ann({ id: '2', user_id: 'u1', user_display_name: 'Sam', body: 'mine 2 starred', starred: true }),
  ann({ id: '3', user_id: 'u2', user_display_name: 'Mira', body: 'theirs' }),
];

const baseProps = {
  annotations,
  selfUserId: 'u1',
  activeId: null as string | null,
  userColorMap: new Map([['u2', '#6f8559']]),
  canEdit: true,
  onSelect: vi.fn(),
  onToggleStar: vi.fn(),
  onSaveEdit: vi.fn(),
  onDelete: vi.fn(),
  onCopyLink: vi.fn(),
};

describe('CommentList', () => {
  it('renders a card per annotation', () => {
    render(<CommentList {...baseProps} />);
    expect(screen.getAllByTestId(/^list-card-/)).toHaveLength(3);
  });

  it('Starred chip filters to starred only', async () => {
    const user = userEvent.setup();
    render(<CommentList {...baseProps} />);
    await user.click(screen.getByRole('tab', { name: /starred/i }));
    expect(screen.getAllByTestId(/^list-card-/)).toHaveLength(1);
    expect(screen.getByText('mine 2 starred')).not.toBeNull();
  });

  it('Mine chip filters to current user only', async () => {
    const user = userEvent.setup();
    render(<CommentList {...baseProps} />);
    await user.click(screen.getByRole('tab', { name: /^mine/i }));
    expect(screen.getAllByTestId(/^list-card-/)).toHaveLength(2);
    expect(screen.queryByText('theirs')).toBeNull();
  });

  it('per-author chips appear when 2+ authors', () => {
    render(<CommentList {...baseProps} />);
    expect(screen.getByRole('tab', { name: /mira/i })).not.toBeNull();
  });

  it('per-author chips hidden when 1 author', () => {
    render(
      <CommentList
        {...baseProps}
        annotations={annotations.filter((a) => a.user_id === 'u1')}
      />,
    );
    expect(screen.queryByRole('tab', { name: /mira/i })).toBeNull();
  });

  it('clicking a card calls onSelect with the annotation', async () => {
    const onSelect = vi.fn();
    render(<CommentList {...baseProps} onSelect={onSelect} />);
    await userEvent.click(screen.getByTestId('list-card-1'));
    expect(onSelect).toHaveBeenCalledWith(annotations[0]);
  });

  it('active card has .active class', () => {
    render(<CommentList {...baseProps} activeId="2" />);
    expect(screen.getByTestId('list-card-2').className).toContain('active');
  });

  it('clicking star button calls onToggleStar', async () => {
    const onToggleStar = vi.fn();
    render(<CommentList {...baseProps} canEdit onToggleStar={onToggleStar} />);
    await userEvent.click(screen.getAllByLabelText(/star/i)[0]);
    expect(onToggleStar).toHaveBeenCalledWith(annotations[0]);
  });

  it('star click does not also call onSelect', async () => {
    const onSelect = vi.fn();
    const onToggleStar = vi.fn();
    render(<CommentList {...baseProps} canEdit onSelect={onSelect} onToggleStar={onToggleStar} />);
    await userEvent.click(screen.getAllByLabelText(/star/i)[0]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('edit button replaces card body with textarea; Save calls onSaveEdit', async () => {
    const onSaveEdit = vi.fn();
    const user = userEvent.setup();
    render(<CommentList {...baseProps} canEdit onSaveEdit={onSaveEdit} />);
    await user.click(screen.getAllByLabelText('Edit')[0]);
    const ta = screen.getByRole('textbox');
    await user.clear(ta);
    await user.type(ta, 'updated');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(onSaveEdit).toHaveBeenCalledWith(annotations[0], 'updated');
  });

  it('delete button (confirmed) calls onDelete', async () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CommentList {...baseProps} canEdit onDelete={onDelete} />);
    await userEvent.click(screen.getAllByLabelText('Delete')[0]);
    expect(onDelete).toHaveBeenCalledWith(annotations[0]);
  });

  it('non-owner does not see edit/delete', () => {
    render(<CommentList {...baseProps} canEdit />);
    const miraCard = screen.getByTestId('list-card-3');
    expect(miraCard.querySelector('[aria-label="Edit"]')).toBeNull();
    expect(miraCard.querySelector('[aria-label="Delete"]')).toBeNull();
  });
});
