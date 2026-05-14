import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Minimap } from './Minimap';

// At hZoom=2, stageWidth=800, railWidth=260:
//   innerWidth = stageWidth * hZoom = 1600
//   waveWidth = innerWidth - railWidth = 1340
//   visibleWaveWidth = stageWidth - railWidth = 540
const baseProps = {
  duration: 60,
  hZoom: 2,
  scrollLeft: 0,
  viewportWidth: 800,
  innerWidth: 1600,
  waveWidth: 1340,
  visibleWaveWidth: 540,
  annotations: [],
  loop: null,
  currentTime: 15,
  userColorMap: new Map<string, string>(),
};

describe('Minimap', () => {
  it('renders viewport rect sized to visible wave / wave width', () => {
    const { container } = render(
      <Minimap {...baseProps} onSeek={vi.fn()} onScrollTo={vi.fn()} />,
    );
    const rect = container.querySelector('.minimap-rect') as HTMLElement;
    // visibleWaveWidth/waveWidth = 540/1340 ≈ 40.30%
    expect(rect).not.toBeNull();
    expect(rect.style.left).toBe('0%');
    // Accept either rounded form for stability against floating-point quirks
    expect(rect.style.width).toMatch(/^40\.[0-9]+%$/);
  });

  it('renders playhead at proportional time', () => {
    const { container } = render(
      <Minimap {...baseProps} onSeek={vi.fn()} onScrollTo={vi.fn()} />,
    );
    const ph = container.querySelector('.minimap-playhead') as HTMLElement;
    expect(ph).not.toBeNull();
    expect(ph.style.left).toBe('25%'); // 15s / 60s
  });

  it('click outside rect calls onScrollTo', () => {
    const onScrollTo = vi.fn();
    const { container } = render(
      <Minimap {...baseProps} onSeek={vi.fn()} onScrollTo={onScrollTo} />,
    );
    const strip = container.querySelector('.minimap-strip') as HTMLElement;
    // Mock getBoundingClientRect for deterministic math
    strip.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 24,
        width: 1000,
        height: 24,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
    fireEvent.pointerDown(strip, { clientX: 800, clientY: 12, button: 0 });
    expect(onScrollTo).toHaveBeenCalled();
  });

  it('renders annotation dots', () => {
    const { container } = render(
      <Minimap
        {...baseProps}
        annotations={[
          {
            id: 'a1',
            project_id: 'p1',
            user_id: 'u1',
            user_email: 'u@x.com',
            user_display_name: null,
            start_ms: 30_000,
            end_ms: null,
            body: 'x',
            starred: false,
            created_at: 0,
            updated_at: 0,
          },
        ]}
        userColorMap={new Map([['u1', '#ff0000']])}
        onSeek={vi.fn()}
        onScrollTo={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('.minimap-dot').length).toBe(1);
  });
});
