// src/client/components/AnnotationMarkers.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AnnotationMarkers } from './AnnotationMarkers';
import type { Annotation } from '../../shared/types';

const fixture: Annotation = {
  id: 'a1', project_id: 'p1', user_id: 'u1',
  user_email: 'sam@example.com', user_display_name: 'Sam',
  start_ms: 1000, end_ms: null, body: 'note', starred: false,
  created_at: 0, updated_at: 0,
};

const baseProps = {
  annotations: [fixture],
  duration: 10,
  userColorMap: new Map<string, string>(),
  visible: true,
  waveLeftPx: 0,
  waveWidthPx: 1000,
  onSelect: vi.fn(),
  hoveredId: null,
  onHover: vi.fn(),
  onLoopAnnotation: vi.fn(),
  createMode: false,
};

describe('AnnotationMarkers', () => {
  it('renders a marker per visible annotation', () => {
    render(<AnnotationMarkers {...baseProps} />);
    expect(screen.getByTestId(`annotation-marker-${fixture.id}`)).not.toBeNull();
  });

  it('clicking a marker calls onSelect with the annotation', () => {
    const onSelect = vi.fn();
    render(<AnnotationMarkers {...baseProps} onSelect={onSelect} />);
    fireEvent.pointerDown(
      screen.getByTestId(`annotation-marker-${fixture.id}`),
    );
    expect(onSelect).toHaveBeenCalledWith(fixture);
  });

  it('renders nothing when visible is false', () => {
    const { container } = render(<AnnotationMarkers {...baseProps} visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('marker carries data-annotation-id for anchor lookup', () => {
    render(<AnnotationMarkers {...baseProps} />);
    const el = screen.getByTestId(`annotation-marker-${fixture.id}`);
    expect(el.getAttribute('data-annotation-id')).toBe('a1');
  });
});
