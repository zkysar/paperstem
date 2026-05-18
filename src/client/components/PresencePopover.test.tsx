import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PresencePopover } from './PresencePopover';
import type { PresenceRowDto } from '../lib/presence-client';

const TRIGGER_RECT = { left: 100, top: 50, right: 124, bottom: 74 } as DOMRect;

function row(overrides: Partial<PresenceRowDto> = {}): PresenceRowDto {
  return {
    userId: 'u-1',
    displayName: 'Alice',
    emailLocal: 'alice',
    state: 'active',
    lastBeatAt: Date.now(),
    ...overrides,
  };
}

describe('<PresencePopover /> single mode', () => {
  it('renders the name and active state', () => {
    render(<PresencePopover mode="single" rows={[row()]} triggerRect={TRIGGER_RECT} onClose={() => {}} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Active now')).toBeInTheDocument();
  });

  it('falls back to emailLocal when displayName is empty', () => {
    render(
      <PresencePopover
        mode="single"
        rows={[row({ displayName: '', emailLocal: 'bob' })]}
        triggerRect={TRIGGER_RECT}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('bob')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<PresencePopover mode="single" rows={[row()]} triggerRect={TRIGGER_RECT} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking outside the popover', () => {
    const onClose = vi.fn();
    render(
      <div>
        <div data-testid="outside">outside</div>
        <PresencePopover mode="single" rows={[row()]} triggerRect={TRIGGER_RECT} onClose={onClose} />
      </div>,
    );
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when clicking inside the popover', () => {
    const onClose = vi.fn();
    render(<PresencePopover mode="single" rows={[row()]} triggerRect={TRIGGER_RECT} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('<PresencePopover /> list mode', () => {
  it('renders one row per viewer with name + state', () => {
    const rows = [
      row({ userId: 'u-1', displayName: 'Alice', state: 'active', lastBeatAt: Date.now() }),
      row({ userId: 'u-2', displayName: '', emailLocal: 'bob', state: 'idle', lastBeatAt: Date.now() - 5 * 60_000 }),
    ];
    render(<PresencePopover mode="list" rows={rows} triggerRect={TRIGGER_RECT} onClose={() => {}} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Active now')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText('Idle 5 minutes ago')).toBeInTheDocument();
  });
});
