import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { CommentsDrawer } from './CommentsDrawer';
import type { Annotation, AnnotationReply } from '../../shared/types';

vi.mock('./Reactions', () => ({
  Reactions: () => <div data-testid="mock-reactions" />,
}));
vi.mock('./ReplyThread', () => ({
  ReplyThread: () => <div data-testid="mock-reply-thread" />,
}));

const ann: Annotation = {
  id: 'a1', project_id: 'p1', user_id: 'u1',
  user_email: 'sam@example.com', user_display_name: 'Sam',
  start_ms: 1000, end_ms: null, body: 'one', starred: false,
  created_at: 0, updated_at: 0,
  reply_count: 0, reactions: [],
};

const baseProps = {
  open: true,
  isNarrow: false,
  selfUserId: 'u1',
  canEdit: true,
  annotations: [ann],
  userColorMap: new Map<string, string>(),
  activeId: null,
  pendingDraft: null,
  onClose: vi.fn(),
  onSelect: vi.fn(),
  onCreate: vi.fn(),
  onDraftCancel: vi.fn(),
  onToggleStar: vi.fn(),
  onSaveEdit: vi.fn(),
  onDelete: vi.fn(),
  onCopyLink: vi.fn(),
  replies: new Map<string, AnnotationReply[]>(),
  onLoadReplies: vi.fn(),
  onCreateReply: vi.fn(),
  onEditReply: vi.fn(),
  onDeleteReply: vi.fn(),
  onToggleReaction: vi.fn(),
};

describe('CommentsDrawer', () => {
  it('does not render when closed', () => {
    const { container } = render(<CommentsDrawer {...baseProps} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders heading and list when open', () => {
    render(<CommentsDrawer {...baseProps} />);
    expect(screen.getByRole('heading', { name: /all comments/i })).not.toBeNull();
    expect(screen.getByText('one')).not.toBeNull();
  });

  it('close button calls onClose', async () => {
    const onClose = vi.fn();
    render(<CommentsDrawer {...baseProps} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText(/close/i));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('backdrop click calls onClose (desktop)', () => {
    const onClose = vi.fn();
    render(<CommentsDrawer {...baseProps} onClose={onClose} />);
    fireEvent.pointerDown(screen.getByTestId('comments-drawer-backdrop'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('no backdrop in narrow (mobile) mode', () => {
    render(<CommentsDrawer {...baseProps} isNarrow />);
    expect(screen.queryByTestId('comments-drawer-backdrop')).toBeNull();
  });

  it('shows draft compose when pendingDraft is set', () => {
    render(
      <CommentsDrawer
        {...baseProps}
        pendingDraft={{ start_ms: 0, end_ms: null }}
      />,
    );
    expect(screen.getByRole('textbox')).not.toBeNull();
    expect(screen.getByRole('button', { name: /save/i })).not.toBeNull();
  });

  it('cancel draft calls onDraftCancel', async () => {
    const onDraftCancel = vi.fn();
    render(
      <CommentsDrawer
        {...baseProps}
        pendingDraft={{ start_ms: 0, end_ms: null }}
        onDraftCancel={onDraftCancel}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onDraftCancel).toHaveBeenCalledOnce();
  });

  it('Escape in draft textarea calls onDraftCancel', () => {
    const onDraftCancel = vi.fn();
    render(
      <CommentsDrawer
        {...baseProps}
        pendingDraft={{ start_ms: 0, end_ms: null }}
        onDraftCancel={onDraftCancel}
      />,
    );
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onDraftCancel).toHaveBeenCalledOnce();
  });

  it('shows footer hint when no draft and not narrow', () => {
    render(<CommentsDrawer {...baseProps} />);
    expect(screen.getByText(/drag a region/i)).not.toBeNull();
  });
});
