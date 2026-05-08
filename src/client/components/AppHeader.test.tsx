import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { AppHeader } from './AppHeader';

const baseProps = {
  userEmail: 'zach@example.com',
  userInitials: 'ZK',
  practiceTitle: 'Practice 2026-04-28',
  stemCount: 9,
  duration: 272.5,
  driveFolderId: 'drive-1',
  annotationsOpen: false,
  hasPractice: true,
  onOpenPicker: vi.fn(),
  onToggleAnnotations: vi.fn(),
  onSignOut: vi.fn(),
};

describe('AppHeader', () => {
  it('renders brand and practice title', () => {
    render(<AppHeader {...baseProps} />);
    expect(screen.getByText('Paperstem')).not.toBeNull();
    expect(screen.getByText('Practice 2026-04-28')).not.toBeNull();
    expect(screen.getByText(/9 stems/)).not.toBeNull();
  });

  it('clicking ▦ calls onOpenPicker', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} onOpenPicker={onOpen} />);
    await user.click(screen.getByLabelText('Open practices'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('clicking ▾ caret calls onOpenPicker', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} onOpenPicker={onOpen} />);
    await user.click(screen.getByLabelText('Switch practice'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('clicking the title TEXT does NOT call onOpenPicker (reserved for rename)', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} onOpenPicker={onOpen} />);
    await user.click(screen.getByText('Practice 2026-04-28'));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('hides 💬 and metadata when no practice loaded', () => {
    render(<AppHeader {...baseProps} hasPractice={false} practiceTitle={null} stemCount={0} duration={0} driveFolderId={null} />);
    expect(screen.queryByTitle('Comments')).toBeNull();
    expect(screen.queryByText(/stems/)).toBeNull();
  });

  it('avatar dropdown shows email and Sign out', async () => {
    const onSignOut = vi.fn();
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} onSignOut={onSignOut} />);
    await user.click(screen.getByLabelText('Account'));
    expect(screen.getByText('zach@example.com')).not.toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('clicking outside the avatar menu closes it', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <AppHeader {...baseProps} />
        <div data-testid="outside">outside</div>
      </div>
    );
    await user.click(screen.getByLabelText('Account'));
    expect(screen.getByText('zach@example.com')).not.toBeNull();
    await user.click(screen.getByTestId('outside'));
    expect(screen.queryByText('zach@example.com')).toBeNull();
  });
});
