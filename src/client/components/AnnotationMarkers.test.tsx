import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnnotationMarkers } from './AnnotationMarkers';
import type { Annotation } from '../../shared/types';

const fixture: Annotation = {
  id: 'a1', project_id: 'p1', user_id: 'u1',
  user_email: 'sam@example.com', user_display_name: 'Sam',
  start_ms: 1000, end_ms: null, body: 'note', starred: false,
  created_at: 0, updated_at: 0,
  reply_count: 0, reactions: [],
};

const region: Annotation = {
  id: 'r1', project_id: 'p1', user_id: 'u1',
  user_email: 'sam@example.com', user_display_name: 'Sam',
  start_ms: 1000, end_ms: 3000, body: 'note', starred: false,
  created_at: 0, updated_at: 0,
  reply_count: 0, reactions: [],
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

  it('a quick tap on the marker opens the comment (calls onSelect)', () => {
    const onSelect = vi.fn();
    render(<AnnotationMarkers {...baseProps} onSelect={onSelect} />);
    const marker = screen.getByTestId(`annotation-marker-${fixture.id}`);
    (marker as any).setPointerCapture = vi.fn();
    (marker as any).releasePointerCapture = vi.fn();

    fireEvent.pointerDown(marker, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 100, pointerId: 1 });

    expect(onSelect).toHaveBeenCalledWith(fixture);
  });

  it('edge grip pointerdown does not call onSelect', () => {
    const onSelect = vi.fn();
    render(
      <AnnotationMarkers
        {...baseProps}
        annotations={[region]}
        hoveredId="r1"
        selfUserId="u1"
        onSelect={onSelect}
      />,
    );
    const grip = document.querySelector(
      `[data-testid="annotation-marker-r1"] .annotation-grip-left`,
    )!;
    fireEvent.pointerDown(grip, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 100, pointerId: 1 });

    expect(onSelect).not.toHaveBeenCalled();
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

  it('renders the same marker regardless of reply_count and reactions', () => {
    const annWithThread: Annotation = {
      ...fixture,
      reply_count: 5,
      reactions: [
        { emoji: '👍', count: 3, user_ids: ['u1', 'u2', 'u3'], reacted_by_self: true },
      ],
    };
    const { container } = render(
      <AnnotationMarkers {...baseProps} annotations={[annWithThread]} />,
    );
    expect(container.querySelectorAll('.annotation-marker').length).toBe(1);
    expect(container.querySelector('.reaction-pill')).toBeNull();
    expect(container.querySelector('.reply-thread')).toBeNull();
  });
});

describe('AnnotationMarkers — hold-to-drag', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('moving before the hold timer fires does not start a drag (no patch)', () => {
    const onPatchAnnotation = vi.fn(async () => {});
    render(
      <AnnotationMarkers
        {...baseProps}
        annotations={[region]}
        hoveredId="r1"
        selfUserId="u1"
        onPatchAnnotation={onPatchAnnotation}
      />,
    );
    const marker = screen.getByTestId('annotation-marker-r1');
    (marker as any).setPointerCapture = vi.fn();
    (marker as any).releasePointerCapture = vi.fn();

    fireEvent.pointerDown(marker, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 240, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 240, pointerId: 1 });

    expect(onPatchAnnotation).not.toHaveBeenCalled();
  });

  it('Escape during a held annotation drag cancels the patch', () => {
    const onPatchAnnotation = vi.fn(async () => {});
    render(
      <AnnotationMarkers
        {...baseProps}
        annotations={[region]}
        hoveredId="r1"
        selfUserId="u1"
        onPatchAnnotation={onPatchAnnotation}
      />,
    );
    const marker = screen.getByTestId('annotation-marker-r1');
    (marker as any).setPointerCapture = vi.fn();
    (marker as any).releasePointerCapture = vi.fn();

    fireEvent.pointerDown(marker, { clientX: 200, pointerId: 1 });
    vi.advanceTimersByTime(200);
    fireEvent.pointerMove(window, { clientX: 240, pointerId: 1 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(window, { clientX: 240, pointerId: 1 });

    expect(onPatchAnnotation).not.toHaveBeenCalled();
  });

  it('middle drag of a region shifts both start_ms and end_ms by same delta', () => {
    const onPatchAnnotation = vi.fn(async () => {});
    render(
      <AnnotationMarkers
        {...baseProps}
        annotations={[region]}
        hoveredId="r1"
        selfUserId="u1"
        onPatchAnnotation={onPatchAnnotation}
      />,
    );
    const marker = screen.getByTestId('annotation-marker-r1');
    (marker as any).setPointerCapture = vi.fn();
    (marker as any).releasePointerCapture = vi.fn();

    fireEvent.pointerDown(marker, { clientX: 200, pointerId: 1 });
    vi.advanceTimersByTime(200);
    fireEvent.pointerMove(window, { clientX: 240, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 240, pointerId: 1 });

    // baseProps: waveWidthPx=1000, duration=10 -> 10ms/px.
    // 40px * 10ms/px = 400ms. region: start=1000 end=3000.
    expect(onPatchAnnotation).toHaveBeenCalledWith('r1', {
      start_ms: 1400,
      end_ms: 3400,
    });
  });

  it('middle drag of a point marker shifts only start_ms (end_ms stays null)', () => {
    const onPatchAnnotation = vi.fn(async () => {});
    render(
      <AnnotationMarkers
        {...baseProps}
        hoveredId="a1"
        selfUserId="u1"
        onPatchAnnotation={onPatchAnnotation}
      />,
    );
    const marker = screen.getByTestId('annotation-marker-a1');
    (marker as any).setPointerCapture = vi.fn();
    (marker as any).releasePointerCapture = vi.fn();

    fireEvent.pointerDown(marker, { clientX: 100, pointerId: 1 });
    vi.advanceTimersByTime(200);
    fireEvent.pointerMove(window, { clientX: 120, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 120, pointerId: 1 });

    // 20px * 10ms/px = 200ms. fixture start=1000.
    expect(onPatchAnnotation).toHaveBeenCalledWith('a1', {
      start_ms: 1200,
      end_ms: null,
    });
  });

  it('a held middle-drag of a region marker adds the "armed" class to the marker', () => {
    render(
      <AnnotationMarkers
        {...baseProps}
        annotations={[region]}
        hoveredId="r1"
        selfUserId="u1"
        onPatchAnnotation={vi.fn(async () => {})}
      />,
    );
    const marker = screen.getByTestId('annotation-marker-r1');
    (marker as any).setPointerCapture = vi.fn();
    (marker as any).releasePointerCapture = vi.fn();
    expect(marker.classList.contains('armed')).toBe(false);

    fireEvent.pointerDown(marker, { clientX: 200, pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(marker.classList.contains('armed')).toBe(true);

    fireEvent.pointerUp(window, { clientX: 200, pointerId: 1 });
    expect(marker.classList.contains('armed')).toBe(false);
  });
});

it('left edge drag on a region calls onPatchAnnotation with new start_ms', () => {
  const onPatchAnnotation = vi.fn(async () => {});
  render(
    <AnnotationMarkers
      {...baseProps}
      annotations={[region]}
      hoveredId="r1"
      selfUserId="u1"
      onPatchAnnotation={onPatchAnnotation}
    />,
  );
  const grip = document.querySelector(
    `[data-testid="annotation-marker-${region.id}"] .annotation-grip-left`,
  )!;
  (grip as any).setPointerCapture = vi.fn();
  (grip as any).releasePointerCapture = vi.fn();

  fireEvent.pointerDown(grip, { clientX: 100, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 150, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: 150, pointerId: 1 });

  // baseProps: waveWidthPx=1000, duration=10 -> 10ms/px.
  // 50px * 10ms/px = 500ms. New start_ms = 1000 + 500 = 1500.
  expect(onPatchAnnotation).toHaveBeenCalledWith('r1', {
    start_ms: 1500,
    end_ms: 3000,
  });
});

it('right edge drag on a region calls onPatchAnnotation with new end_ms', () => {
  const onPatchAnnotation = vi.fn(async () => {});
  render(
    <AnnotationMarkers
      {...baseProps}
      annotations={[region]}
      hoveredId="r1"
      selfUserId="u1"
      onPatchAnnotation={onPatchAnnotation}
    />,
  );
  const grip = document.querySelector(
    `[data-testid="annotation-marker-${region.id}"] .annotation-grip-right`,
  )!;
  (grip as any).setPointerCapture = vi.fn();
  (grip as any).releasePointerCapture = vi.fn();

  fireEvent.pointerDown(grip, { clientX: 300, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 350, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: 350, pointerId: 1 });

  expect(onPatchAnnotation).toHaveBeenCalledWith('r1', {
    start_ms: 1000,
    end_ms: 3500,
  });
});

it('does not render grips when annotation is not authored by self', () => {
  render(
    <AnnotationMarkers
      {...baseProps}
      annotations={[{ ...region, user_id: 'someone-else' }]}
      hoveredId="r1"
      selfUserId="u1"
    />,
  );
  expect(document.querySelector('.annotation-grip-left')).toBeNull();
  expect(document.querySelector('.annotation-grip-right')).toBeNull();
});

it('cannot shrink region below 100ms via left-edge drag', () => {
  const onPatchAnnotation = vi.fn(async () => {});
  const tightRegion: Annotation = { ...region, start_ms: 1000, end_ms: 1200 };
  render(
    <AnnotationMarkers
      {...baseProps}
      annotations={[tightRegion]}
      hoveredId="r1"
      selfUserId="u1"
      onPatchAnnotation={onPatchAnnotation}
    />,
  );
  const grip = document.querySelector(
    `[data-testid="annotation-marker-r1"] .annotation-grip-left`,
  )!;
  (grip as any).setPointerCapture = vi.fn();
  (grip as any).releasePointerCapture = vi.fn();

  fireEvent.pointerDown(grip, { clientX: 100, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 200, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: 200, pointerId: 1 });

  // 100px * 10ms/px = 1000ms unsnapped — clamped to maxStart = end_ms - 100 = 1100.
  expect(onPatchAnnotation).toHaveBeenCalledWith('r1', {
    start_ms: 1100,
    end_ms: 1200,
  });
});
