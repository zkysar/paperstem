import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DetectionBanner } from './DetectionBanner';

describe('DetectionBanner', () => {
  it('renders the rounded percentage', () => {
    const { getByText } = render(<DetectionBanner progress={0.473} />);
    expect(getByText('47%')).not.toBeNull();
  });

  it('clamps progress to [0,1]', () => {
    const { getByText, rerender } = render(<DetectionBanner progress={-0.5} />);
    expect(getByText('0%')).not.toBeNull();
    rerender(<DetectionBanner progress={5} />);
    expect(getByText('100%')).not.toBeNull();
  });

  it('sets the progress-bar width to match', () => {
    const { container } = render(<DetectionBanner progress={0.62} />);
    const bar = container.querySelector('.detection-banner-bar') as HTMLElement;
    expect(bar.style.width).toBe('62%');
  });
});
