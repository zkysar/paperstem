import { render } from '@testing-library/react';
import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { Ruler } from './Ruler';

describe('Ruler', () => {
  it('renders without crashing', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <Ruler duration={120} onPointerDown={vi.fn()} rulerRef={ref} />,
    );
    expect(container.querySelector('.ruler')).not.toBeNull();
  });

  it('renders exactly two tick labels (start and end)', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <Ruler duration={120} onPointerDown={vi.fn()} rulerRef={ref} />,
    );
    const labels = container.querySelectorAll('.ruler-label');
    expect(labels).toHaveLength(2);
  });

  it('label values are 0:00 at left and formatted duration at right', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <Ruler duration={120} onPointerDown={vi.fn()} rulerRef={ref} />,
    );
    const labels = [...container.querySelectorAll<HTMLElement>('.ruler-label')].map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(['0:00', '2:00']);
  });

  it('still renders three inner tick marks (at 25%, 50%, 75%) — only labels were dropped', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <Ruler duration={60} onPointerDown={vi.fn()} rulerRef={ref} />,
    );
    const ticks = container.querySelectorAll('.ruler-tick');
    expect(ticks).toHaveLength(3);
  });

  it('inner ticks are positioned at 25%, 50%, and 75%', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <Ruler duration={60} onPointerDown={vi.fn()} rulerRef={ref} />,
    );
    const ticks = [...container.querySelectorAll<HTMLElement>('.ruler-tick')].map(
      (el) => el.style.left,
    );
    expect(ticks).toEqual(['25%', '50%', '75%']);
  });

  it('renders 0:00 twice for duration = 0', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <Ruler duration={0} onPointerDown={vi.fn()} rulerRef={ref} />,
    );
    const labels = [...container.querySelectorAll<HTMLElement>('.ruler-label')].map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(['0:00', '0:00']);
  });
});
