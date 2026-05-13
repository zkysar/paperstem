import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FollowPill } from './FollowPill';

describe('FollowPill', () => {
  it('shows on label when active', () => {
    render(<FollowPill active={true} onToggle={vi.fn()} />);
    const btn = screen.getByRole('button');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toMatch(/follow.*on/i);
  });

  it('shows off label when inactive', () => {
    render(<FollowPill active={false} onToggle={vi.fn()} />);
    const btn = screen.getByRole('button');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toMatch(/follow.*off/i);
  });

  it('click calls onToggle', () => {
    const onToggle = vi.fn();
    render(<FollowPill active={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
