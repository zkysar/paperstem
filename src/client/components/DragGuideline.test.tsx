import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DragGuideline } from './DragGuideline';

describe('DragGuideline', () => {
  it('renders nothing when visible is false', () => {
    const { container } = render(<DragGuideline visible={false} leftPx={100} />);
    expect(container.firstChild).toBeNull();
  });
  it('renders a line at the given leftPx when visible', () => {
    const { container } = render(<DragGuideline visible leftPx={123} />);
    const el = container.querySelector<HTMLDivElement>('.drag-guideline');
    expect(el).not.toBeNull();
    expect(el!.style.left).toBe('123px');
  });
});
