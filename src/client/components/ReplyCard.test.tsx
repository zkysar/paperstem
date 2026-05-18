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
    user_id: 'u-author',
    user_email: 'author@example.test',
    user_display_name: 'Maya Chen',
    body: 'hi',
    // 2 hours ago in seconds (server stores created_at as Unix seconds)
    created_at: Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000),
    updated_at: 0,
    reactions: [],
    ...over,
  };
}

const colorMap = new Map<string, string>([
  ['u-author', '#3b6e8c'],
  ['u-self', '#b14a3c'],
]);

describe('ReplyCard', () => {
  it('renders avatar with initials derived from display name', () => {
    render(
      <ReplyCard
        reply={makeReply()}
        selfUserId="u-self"
        userColorMap={colorMap}
        canEdit={true}
        isNarrow={false}
        onEdit={() => {}}
        onDelete={() => {}}
        onToggleReaction={() => {}}
      />,
    );
    // Initials: "MA" from "Maya Chen" (first two of first word, uppercased).
    expect(screen.getByText('MA')).toBeTruthy();
  });

  it('falls back to email initials when display name missing', () => {
    render(
      <ReplyCard
        reply={makeReply({ user_display_name: null })}
        selfUserId="u-self"
        userColorMap={colorMap}
        canEdit={true}
        isNarrow={false}
        onEdit={() => {}}
        onDelete={() => {}}
        onToggleReaction={() => {}}
      />,
    );
    expect(screen.getByText('AU')).toBeTruthy();
  });

  it('renders author name and a relative timestamp', () => {
    render(
      <ReplyCard
        reply={makeReply()}
        selfUserId="u-self"
        userColorMap={colorMap}
        canEdit={true}
        isNarrow={false}
        onEdit={() => {}}
        onDelete={() => {}}
        onToggleReaction={() => {}}
      />,
    );
    expect(screen.getByText('Maya Chen')).toBeTruthy();
    expect(screen.getByText('2h ago')).toBeTruthy();
  });

  it('overflow menu exposes Edit/Delete for the author', () => {
    render(
      <ReplyCard
        reply={makeReply({ user_id: 'u-self' })}
        selfUserId="u-self"
        userColorMap={colorMap}
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
        selfUserId="u-self"
        userColorMap={colorMap}
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
        reply={makeReply({ user_id: 'u-self' })}
        selfUserId="u-self"
        userColorMap={colorMap}
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
