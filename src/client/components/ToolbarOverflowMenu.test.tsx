import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ToolbarOverflowMenu } from './ToolbarOverflowMenu';

const baseProps = {
  waveformNormalization: 'per-track' as const,
  markersVisible: true,
  railCollapsed: false,
  showRailToggle: true,
  onToggleWaveformNormalization: vi.fn(),
  onToggleMarkersVisible: vi.fn(),
  onToggleRailCollapsed: vi.fn(),
  onOpenShortcuts: vi.fn(),
};

describe('ToolbarOverflowMenu', () => {
  it('renders a single ⋯ trigger button when closed', () => {
    render(<ToolbarOverflowMenu {...baseProps} />);
    expect(screen.getByLabelText('More options')).not.toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a labeled menu listing all four items on click', async () => {
    const user = userEvent.setup();
    render(<ToolbarOverflowMenu {...baseProps} />);
    await user.click(screen.getByLabelText('More options'));
    expect(screen.getByRole('menu')).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /waveform/i })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /markers/i })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /track controls/i })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /keyboard shortcuts/i })).not.toBeNull();
  });

  it('omits the rail-collapse item when showRailToggle is false', async () => {
    const user = userEvent.setup();
    render(<ToolbarOverflowMenu {...baseProps} showRailToggle={false} />);
    await user.click(screen.getByLabelText('More options'));
    expect(screen.queryByRole('menuitem', { name: /track controls/i })).toBeNull();
  });

  it('clicking a menuitem fires its handler and closes the menu', async () => {
    const onToggleMarkers = vi.fn();
    const user = userEvent.setup();
    render(<ToolbarOverflowMenu {...baseProps} onToggleMarkersVisible={onToggleMarkers} />);
    await user.click(screen.getByLabelText('More options'));
    await user.click(screen.getByRole('menuitem', { name: /markers/i }));
    expect(onToggleMarkers).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('clicking outside the menu closes it', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ToolbarOverflowMenu {...baseProps} />
        <div data-testid="outside">outside</div>
      </div>,
    );
    await user.click(screen.getByLabelText('More options'));
    expect(screen.getByRole('menu')).not.toBeNull();
    await user.click(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows current state in the menu item labels', async () => {
    const user = userEvent.setup();
    render(
      <ToolbarOverflowMenu
        {...baseProps}
        waveformNormalization="global"
        markersVisible={false}
        railCollapsed={true}
      />,
    );
    await user.click(screen.getByLabelText('More options'));
    expect(screen.getByRole('menuitem', { name: /waveform.*global/i })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /markers.*hidden/i })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /show track controls/i })).not.toBeNull();
  });
});
