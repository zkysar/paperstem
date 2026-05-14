import { render, screen } from '@testing-library/react';
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

  it('renders exactly five tick labels', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <Ruler duration={120} onPointerDown={vi.fn()} rulerRef={ref} />,
    );
    const labels = container.querySelectorAll('.ruler-label');
    expect(labels).toHaveLength(5);
  });

  it('label values match expected time fractions of the duration', () => {
    // duration = 120 s; ticks at 0%, 25%, 50%, 75%, 100%
    // fmt(0) = "0:00", fmt(30) = "0:30", fmt(60) = "1:00", fmt(90) = "1:30", fmt(120) = "2:00"
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <Ruler duration={120} onPointerDown={vi.fn()} rulerRef={ref} />,
    );
    const labels = [...container.querySelectorAll<HTMLElement>('.ruler-label')].map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(['0:00', '0:30', '1:00', '1:30', '2:00']);
  });

  it('renders three inner tick marks (at 25%, 50%, 75%)', () => {
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

  it('renders 0:00 for duration = 0', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <Ruler duration={0} onPointerDown={vi.fn()} rulerRef={ref} />,
    );
    const labels = [...container.querySelectorAll<HTMLElement>('.ruler-label')].map(
      (el) => el.textContent,
    );
    // All five fractions of 0 should be "0:00".
    expect(labels).toEqual(['0:00', '0:00', '0:00', '0:00', '0:00']);
  });
});
