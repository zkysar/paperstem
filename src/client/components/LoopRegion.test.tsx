import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LoopRegion } from './LoopRegion';

describe('LoopRegion', () => {
  it('renders nothing when visible is false', () => {
    const { container } = render(
      <LoopRegion
        visible={false}
        enabled={true}
        leftPx={100}
        widthPx={200}
        onPointerDown={vi.fn()}
      />,
    );
    expect(container.querySelector('.loop-region')).toBeNull();
  });

  it('renders the region element when visible is true', () => {
    const { container } = render(
      <LoopRegion
        visible={true}
        enabled={true}
        leftPx={50}
        widthPx={300}
        onPointerDown={vi.fn()}
      />,
    );
    expect(container.querySelector('.loop-region')).not.toBeNull();
  });

  it('positions the region at the expected pixel offsets via inline style', () => {
    const { container } = render(
      <LoopRegion
        visible={true}
        enabled={true}
        leftPx={80}
        widthPx={150}
        onPointerDown={vi.fn()}
      />,
    );
    const region = container.querySelector<HTMLElement>('.loop-region')!;
    expect(region.style.left).toBe('80px');
    expect(region.style.width).toBe('150px');
  });

  it('adds the disabled class when enabled is false', () => {
    const { container } = render(
      <LoopRegion
        visible={true}
        enabled={false}
        leftPx={0}
        widthPx={100}
        onPointerDown={vi.fn()}
      />,
    );
    expect(container.querySelector('.loop-region')?.classList.contains('disabled')).toBe(true);
  });

  it('does not add the disabled class when enabled is true', () => {
    const { container } = render(
      <LoopRegion
        visible={true}
        enabled={true}
        leftPx={0}
        widthPx={100}
        onPointerDown={vi.fn()}
      />,
    );
    expect(container.querySelector('.loop-region')?.classList.contains('disabled')).toBe(false);
  });

  it('renders left and right handles', () => {
    const { container } = render(
      <LoopRegion
        visible={true}
        enabled={true}
        leftPx={0}
        widthPx={100}
        onPointerDown={vi.fn()}
      />,
    );
    expect(container.querySelector('.loop-handle.left')).not.toBeNull();
    expect(container.querySelector('.loop-handle.right')).not.toBeNull();
  });
});
