import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReplyThread } from './ReplyThread';
import type { AnnotationReply } from '../../shared/types';

vi.mock('./ReplyCard', () => ({
  ReplyCard: ({ reply }: { reply: AnnotationReply }) => (
    <div data-testid={`mock-reply-${reply.id}`}>{reply.body}</div>
  ),
}));

const colorMap = new Map<string, string>([['u1', '#b14a3c']]);

const baseProps = {
  annotationId: 'a1',
  replyCount: 0,
  replies: undefined as AnnotationReply[] | undefined,
  selfUserId: 'u1',
  selfDisplayName: 'Riley',
  selfColor: '#b14a3c',
  userColorMap: colorMap,
  canEdit: true,
  isNarrow: false,
  onLoadReplies: vi.fn().mockResolvedValue(undefined),
  onCreateReply: vi.fn().mockResolvedValue(undefined),
  onEditReply: vi.fn(),
  onDeleteReply: vi.fn(),
  onToggleReaction: vi.fn(),
};

describe('ReplyThread', () => {
  it('calls onLoadReplies once when mounted with undefined replies', async () => {
    const onLoad = vi.fn().mockResolvedValue(undefined);
    render(
      <ReplyThread
        {...baseProps}
        replyCount={2}
        replies={undefined}
        onLoadReplies={onLoad}
      />,
    );
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    expect(onLoad).toHaveBeenCalledWith('a1');
  });

  it('does not call onLoadReplies when replies are already provided', () => {
    const onLoad = vi.fn().mockResolvedValue(undefined);
    render(
      <ReplyThread
        {...baseProps}
        replyCount={1}
        replies={[]}
        onLoadReplies={onLoad}
      />,
    );
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('renders provided replies via ReplyCard', () => {
    const replies: AnnotationReply[] = [
      {
        id: 'r1', annotation_id: 'a1', user_id: 'u2',
        user_email: 'a@b.test', user_display_name: 'A',
        body: 'first', created_at: 0, updated_at: 0, reactions: [],
      },
      {
        id: 'r2', annotation_id: 'a1', user_id: 'u3',
        user_email: 'b@c.test', user_display_name: 'B',
        body: 'second', created_at: 0, updated_at: 0, reactions: [],
      },
    ];
    render(<ReplyThread {...baseProps} replyCount={2} replies={replies} />);
    expect(screen.getByTestId('mock-reply-r1')).toBeTruthy();
    expect(screen.getByTestId('mock-reply-r2')).toBeTruthy();
  });

  it('renders the composer pill in its resting state', () => {
    render(<ReplyThread {...baseProps} replies={[]} />);
    expect(screen.getByRole('button', { name: /reply…/i })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /reply/i })).toBeNull();
  });

  it('does not render the composer when canEdit is false', () => {
    render(<ReplyThread {...baseProps} replies={[]} canEdit={false} />);
    expect(screen.queryByRole('button', { name: /reply…/i })).toBeNull();
  });

  it('clicking the pill opens the textarea with autofocus', () => {
    render(<ReplyThread {...baseProps} replies={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /reply…/i }));
    const ta = screen.getByRole('textbox', { name: /reply/i });
    expect(ta).toBeTruthy();
    expect(document.activeElement).toBe(ta);
  });

  it('submits a reply on Cmd+Enter and collapses back to the pill', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <ReplyThread {...baseProps} replies={[]} onCreateReply={onCreate} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /reply…/i }));
    const ta = screen.getByRole('textbox', { name: /reply/i });
    fireEvent.change(ta, { target: { value: 'looks great' } });
    fireEvent.keyDown(ta, { key: 'Enter', metaKey: true });
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith('a1', 'looks great'),
    );
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: /reply/i })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: /reply…/i })).toBeTruthy();
  });

  it('keeps the draft and shows error on submit failure', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('nope'));
    render(
      <ReplyThread {...baseProps} replies={[]} onCreateReply={onCreate} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /reply…/i }));
    const ta = screen.getByRole('textbox', { name: /reply/i }) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'will fail' } });
    fireEvent.keyDown(ta, { key: 'Enter', metaKey: true });
    await waitFor(() =>
      expect(screen.getByText(/couldn't send reply/i)).toBeTruthy(),
    );
    expect(ta.value).toBe('will fail');
  });

  it('Escape collapses the open composer and clears the draft', () => {
    render(<ReplyThread {...baseProps} replies={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /reply…/i }));
    const ta = screen.getByRole('textbox', { name: /reply/i });
    fireEvent.change(ta, { target: { value: 'never mind' } });
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: /reply/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /reply…/i }));
    const ta2 = screen.getByRole('textbox', { name: /reply/i }) as HTMLTextAreaElement;
    expect(ta2.value).toBe('');
  });

  it('refetches when annotationId changes', async () => {
    const onLoad = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ReplyThread {...baseProps} replyCount={1} onLoadReplies={onLoad} />,
    );
    await waitFor(() => expect(onLoad).toHaveBeenCalledWith('a1'));
    rerender(
      <ReplyThread
        {...baseProps}
        annotationId="a2"
        replyCount={1}
        onLoadReplies={onLoad}
      />,
    );
    await waitFor(() => expect(onLoad).toHaveBeenCalledWith('a2'));
    expect(onLoad).toHaveBeenCalledTimes(2);
  });
});
