import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReplyCard } from './ReplyCard';
import type { AnnotationReply } from '../../shared/types';

vi.mock('./Reactions', () => ({
  Reactions: () => <div data-testid="mock-reactions" />,
}));

function makeReply(over: Partial<AnnotationReply> = {}): AnnotationReply {
  return {
    id: 'r1',
    annotation_id: 'a1',
    user_id: 'u1',
    user_email: 'u@e.test',
    user_display_name: 'U',
    body: 'hi',
    created_at: 0,
    updated_at: 0,
    reactions: [],
    ...over,
  };
}

describe('ReplyCard', () => {
  it('overflow menu exposes Edit/Delete for the author', () => {
    render(
      <ReplyCard
        reply={makeReply()}
        selfUserId="u1"
        canEdit={true}
        isNarrow={false}
        onEdit={() => {}}
        onDelete={() => {}}
        onToggleReaction={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });

  it('non-authors see no overflow trigger', () => {
    render(
      <ReplyCard
        reply={makeReply()}
        selfUserId="other"
        canEdit={true}
        isNarrow={false}
        onEdit={() => {}}
        onDelete={() => {}}
        onToggleReaction={() => {}}
      />,
    );
    expect(screen.queryByLabelText('More actions')).toBeNull();
  });

  it('saves edited body via callback', () => {
    const onEdit = vi.fn();
    render(
      <ReplyCard
        reply={makeReply()}
        selfUserId="u1"
        canEdit={true}
        isNarrow={false}
        onEdit={onEdit}
        onDelete={() => {}}
        onToggleReaction={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'updated' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onEdit).toHaveBeenCalledWith('r1', 'updated');
  });
});
