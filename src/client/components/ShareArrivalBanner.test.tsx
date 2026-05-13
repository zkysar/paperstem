import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShareArrivalBanner } from './ShareArrivalBanner';

describe('ShareArrivalBanner', () => {
  it('shows the timestamp when provided', () => {
    render(
      <ShareArrivalBanner
        time={42}
        categories={[]}
        onPlay={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/0:42/)).not.toBeNull();
  });

  it('falls back to a generic label when no time', () => {
    render(
      <ShareArrivalBanner
        time={null}
        categories={[]}
        onPlay={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/Shared link applied/i)).not.toBeNull();
  });

  it('lists categories', () => {
    render(
      <ShareArrivalBanner
        time={10}
        categories={['loop', 'mix', 'comment']}
        onPlay={() => {}}
        onDismiss={() => {}}
      />,
    );
    // Categories are concatenated in a single text node with `·` separators,
    // so search the document body rather than each category in isolation.
    expect(document.body.textContent).toMatch(/Loop region/);
    expect(document.body.textContent).toMatch(/Custom mix/);
    expect(document.body.textContent).toMatch(/Focused comment/);
  });

  it('calls onPlay when Listen is clicked', () => {
    const onPlay = vi.fn();
    render(
      <ShareArrivalBanner
        time={0}
        categories={[]}
        onPlay={onPlay}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /listen/i }));
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it('calls onDismiss when dismiss is clicked', () => {
    const onDismiss = vi.fn();
    render(
      <ShareArrivalBanner
        time={0}
        categories={[]}
        onPlay={() => {}}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
