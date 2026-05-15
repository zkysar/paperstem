import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SectionHintChip } from './SectionHintChip';

describe('SectionHintChip', () => {
  it('renders nothing when visible is false', () => {
    const { container } = render(
      <SectionHintChip visible={false} onDismiss={vi.fn()} />,
    );
    expect(container.querySelector('.section-hint-chip')).toBeNull();
  });

  it('renders the hint text when visible is true', () => {
    render(<SectionHintChip visible onDismiss={vi.fn()} />);
    expect(screen.getByText(/tap for section labels/i)).not.toBeNull();
  });

  it('calls onDismiss on a document pointerdown', () => {
    const onDismiss = vi.fn();
    render(<SectionHintChip visible onDismiss={onDismiss} />);
    fireEvent.pointerDown(document);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('calls onDismiss on a document touchstart', () => {
    const onDismiss = vi.fn();
    render(<SectionHintChip visible onDismiss={onDismiss} />);
    fireEvent.touchStart(document);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('calls onDismiss on a window scroll', () => {
    const onDismiss = vi.fn();
    render(<SectionHintChip visible onDismiss={onDismiss} />);
    fireEvent.scroll(window);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('does not call onDismiss after being hidden', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <SectionHintChip visible onDismiss={onDismiss} />,
    );
    rerender(<SectionHintChip visible={false} onDismiss={onDismiss} />);
    fireEvent.pointerDown(document);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does not call onDismiss more than once across multiple events', () => {
    const onDismiss = vi.fn();
    render(<SectionHintChip visible onDismiss={onDismiss} />);
    fireEvent.pointerDown(document);
    fireEvent.touchStart(document);
    fireEvent.scroll(window);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
