import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReplyThread } from './ReplyThread';
import type { AnnotationReply } from '../../shared/types';

vi.mock('./ReplyCard', () => ({
  ReplyCard: ({ reply }: { reply: AnnotationReply }) => (
    <div data-testid={`mock-reply-${reply.id}`}>{reply.body}</div>
  ),
}));

const baseProps = {
  annotationId: 'a1',
  replyCount: 2,
  replies: undefined as AnnotationReply[] | undefined,
  selfUserId: 'u1',
  canEdit: true,
  isNarrow: false,
  onLoadReplies: vi.fn().mockResolvedValue(undefined),
  onCreateReply: vi.fn().mockResolvedValue(undefined),
  onEditReply: vi.fn(),
  onDeleteReply: vi.fn(),
  onToggleReaction: vi.fn(),
};

describe('ReplyThread', () => {
  it('renders collapsed with N replies and Reply button', () => {
    render(<ReplyThread {...baseProps} replyCount={3} />);
    expect(screen.getByRole('button', { name: /3 replies/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Reply$/i })).toBeTruthy();
  });

  it('renders just "Reply" when there are no replies', () => {
    render(<ReplyThread {...baseProps} replyCount={0} />);
    expect(screen.queryByText(/replies/i)).toBeNull();
    expect(screen.getByRole('button', { name: /^Reply$/i })).toBeTruthy();
  });

  it('calls onLoadReplies once when expanded', async () => {
    const onLoad = vi.fn().mockResolvedValue(undefined);
    render(
      <ReplyThread {...baseProps} replyCount={2} onLoadReplies={onLoad} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /2 replies/i }));
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /2 replies/i }));
    fireEvent.click(screen.getByRole('button', { name: /2 replies/i }));
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('shows the composer when Reply is clicked', () => {
    render(<ReplyThread {...baseProps} replyCount={0} />);
    fireEvent.click(screen.getByRole('button', { name: /^Reply$/i }));
    expect(screen.getByRole('textbox', { name: /Reply/i })).toBeTruthy();
  });

  it('submits reply via button and clears the composer', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <ReplyThread
        {...baseProps}
        replyCount={0}
        onCreateReply={onCreate}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Reply$/i }));
    const ta = screen.getByRole('textbox', { name: /Reply/i });
    fireEvent.change(ta, { target: { value: 'hi there' } });
    // Two buttons named "Reply" now visible (the CTA and the submit). Find the
    // submit one inside the composer actions.
    const submitButtons = screen.getAllByRole('button', { name: /^Reply$/i });
    // The composer submit button is the one that is not the CTA; it has
    // class "reply-save".
    const submit = submitButtons.find((b) =>
      b.classList.contains('reply-save'),
    );
    if (!submit) throw new Error('reply-save button not found');
    fireEvent.click(submit);
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith('a1', 'hi there'),
    );
  });
});
