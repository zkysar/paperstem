import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { AnnotationsRail } from './AnnotationsRail';
import type { Annotation } from '../../shared/types';

const fixtureAnnotation: Annotation = {
  id: 'a1',
  practice_id: 'p1',
  user_id: 'u1',
  user_email: 'sam@example.com',
  user_display_name: 'Sam',
  start_ms: 1000,
  end_ms: null,
  body: 'first thought',
  starred: false,
  created_at: 0,
  updated_at: 0,
};

const baseProps = {
  open: true,
  practiceId: 'p1',
  selfUserId: 'u1',
  canEdit: true,
  annotations: [],
  userColorMap: new Map<string, string>(),
  markersVisible: true,
  pendingDraft: null,
  highlightId: null,
  hoveredId: null,
  onClose: vi.fn(),
  onSeek: vi.fn(),
  onAnnotationsChange: vi.fn(),
  onDraftCancel: vi.fn(),
  onToggleMarkersVisible: vi.fn(),
  onLoopAnnotation: vi.fn(),
  onHoverAnnotation: vi.fn(),
};

describe('AnnotationsRail header', () => {
  it('renders <h2> Comments', () => {
    render(<AnnotationsRail {...baseProps} />);
    const h = screen.getByRole('heading', { level: 2, name: 'Comments' });
    expect(h).not.toBeNull();
  });

  it('clicking rail-header ◉ calls onToggleMarkersVisible', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<AnnotationsRail {...baseProps} onToggleMarkersVisible={onToggle} />);
    await user.click(screen.getByLabelText('Toggle marker visibility'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('hovering a card calls onHoverAnnotation with id, leaving calls with null', () => {
    const onHover = vi.fn();
    render(
      <AnnotationsRail
        {...baseProps}
        annotations={[fixtureAnnotation]}
        onHoverAnnotation={onHover}
      />,
    );
    const card = screen.getByTestId('rail-card-' + fixtureAnnotation.id);
    fireEvent.pointerEnter(card);
    expect(onHover).toHaveBeenCalledWith(fixtureAnnotation.id);
    fireEvent.pointerLeave(card);
    const lastCall = onHover.mock.calls[onHover.mock.calls.length - 1];
    expect(lastCall[0]).toBe(null);
  });
});
