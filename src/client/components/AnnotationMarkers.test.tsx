import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { AnnotationMarkers } from './AnnotationMarkers';
import type { Annotation } from '../../shared/types';

afterEach(() => {
  cleanup();
});

const ann: Annotation = {
  id: 'a1',
  practice_id: 'p1',
  user_id: 'u1',
  user_email: 'sam@example.com',
  user_display_name: 'Sam',
  start_ms: 1000,
  end_ms: null,
  body: 'Drums fall behind here',
  starred: false,
  created_at: 0,
  updated_at: 0,
};

describe('AnnotationMarkers hover popover', () => {
  it('shows a popover after 150ms hover with full body and author', () => {
    vi.useFakeTimers();
    render(
      <AnnotationMarkers
        annotations={[ann]}
        duration={10}
        userColorMap={new Map([['u1', '#4682b4']])}
        visible={true}
        waveLeftPx={0}
        waveWidthPx={1000}
        hoveredId={null}
        onHover={() => {}}
        onSelect={() => {}}
        onLoopAnnotation={() => {}}
        createMode={false}
      />,
    );
    const marker = screen.getByTestId('annotation-marker-a1');
    fireEvent.pointerEnter(marker, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(140);
    });
    expect(screen.queryByText('Drums fall behind here')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(screen.getByText('Drums fall behind here')).not.toBeNull();
    expect(screen.getByText('Sam')).not.toBeNull();
    expect(screen.getByRole('tooltip')).not.toBeNull();
    vi.useRealTimers();
  });

  it('does not show popover when createMode is true', () => {
    vi.useFakeTimers();
    render(
      <AnnotationMarkers
        annotations={[ann]}
        duration={10}
        userColorMap={new Map([['u1', '#4682b4']])}
        visible={true}
        waveLeftPx={0}
        waveWidthPx={1000}
        hoveredId={null}
        onHover={() => {}}
        onSelect={() => {}}
        onLoopAnnotation={() => {}}
        createMode={true}
      />,
    );
    fireEvent.pointerEnter(
      screen.getByTestId('annotation-marker-a1'),
      { pointerType: 'mouse' },
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    vi.useRealTimers();
  });

  it('does not render markers (and therefore no popover target) when visible is false', () => {
    render(
      <AnnotationMarkers
        annotations={[ann]}
        duration={10}
        userColorMap={new Map([['u1', '#4682b4']])}
        visible={false}
        waveLeftPx={0}
        waveWidthPx={1000}
        hoveredId={null}
        onHover={() => {}}
        onSelect={() => {}}
        onLoopAnnotation={() => {}}
        createMode={false}
      />,
    );
    expect(screen.queryByTestId('annotation-marker-a1')).toBeNull();
  });
});
