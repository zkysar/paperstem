import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ShortcutsOverlay } from './ShortcutsOverlay';

describe('ShortcutsOverlay', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(
      <ShortcutsOverlay open={false} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a dialog when open=true', () => {
    render(<ShortcutsOverlay open={true} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).not.toBeNull();
  });

  it('renders section headings', () => {
    render(<ShortcutsOverlay open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Playback')).not.toBeNull();
    expect(screen.getByText('Zoom & navigation')).not.toBeNull();
  });

  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    render(<ShortcutsOverlay open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders Mac glyph when forceMac=true', () => {
    render(<ShortcutsOverlay open={true} onClose={vi.fn()} forceMac={true} />);
    // The cmd-K shortcut should show ⌘K
    expect(screen.getAllByText(/⌘/)[0]).not.toBeNull();
  });

  it('clicking scrim calls onClose', () => {
    const onClose = vi.fn();
    render(<ShortcutsOverlay open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('shortcuts-scrim'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
