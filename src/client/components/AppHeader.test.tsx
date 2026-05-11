import { render, screen, waitFor } from '@testing-library/react';
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
  canRename: true,
  appVersion: 'test-1.0.0',
  appEnv: null,
  onOpenPicker: vi.fn(),
  onToggleAnnotations: vi.fn(),
  onSignOut: vi.fn(),
  onRenamePractice: vi.fn(),
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

  it('avatar dropdown links the build version to GitHub', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AppHeader {...baseProps} appVersion="dev-6237c11" />);
    await user.click(screen.getByLabelText('Account'));
    const devLink = screen.getByRole('link', { name: 'dev-6237c11' }) as HTMLAnchorElement;
    expect(devLink.href).toBe('https://github.com/zkysar/paperstem/commit/6237c11');
    expect(devLink.target).toBe('_blank');
    expect(devLink.rel).toContain('noopener');

    rerender(<AppHeader {...baseProps} appVersion="v1.2.3" />);
    const tagLink = screen.getByRole('link', { name: 'v1.2.3' }) as HTMLAnchorElement;
    expect(tagLink.href).toBe('https://github.com/zkysar/paperstem/tree/v1.2.3');

    rerender(<AppHeader {...baseProps} appVersion="dev" />);
    const fallback = screen.getByRole('link', { name: 'dev' }) as HTMLAnchorElement;
    expect(fallback.href).toBe('https://github.com/zkysar/paperstem');
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

describe('AppHeader inline rename', () => {
  it('clicking the practice title opens an editable input that submits on Enter', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AppHeader {...baseProps} onRenamePractice={onRename} />);

    await user.click(screen.getByText('Practice 2026-04-28'));
    const input = screen.getByRole('textbox', { name: /rename practice/i });
    await user.clear(input);
    await user.type(input, 'New name{Enter}');

    await waitFor(() => expect(onRename).toHaveBeenCalledWith('New name'));
  });

  it('Escape cancels without firing onRenamePractice', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AppHeader {...baseProps} onRenamePractice={onRename} />);

    await user.click(screen.getByText('Practice 2026-04-28'));
    const input = screen.getByRole('textbox', { name: /rename practice/i });
    await user.type(input, 'changed{Escape}');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('does not enter edit mode when canRename is false', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AppHeader {...baseProps} canRename={false} onRenamePractice={onRename} />);

    await user.click(screen.getByText('Practice 2026-04-28'));
    expect(screen.queryByRole('textbox', { name: /rename practice/i })).toBeNull();
  });

  it('blur commits the rename', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <div>
        <AppHeader {...baseProps} onRenamePractice={onRename} />
        <button type="button" data-testid="elsewhere">elsewhere</button>
      </div>,
    );

    await user.click(screen.getByText('Practice 2026-04-28'));
    const input = screen.getByRole('textbox', { name: /rename practice/i });
    await user.clear(input);
    await user.type(input, 'Blurred name');
    await user.click(screen.getByTestId('elsewhere'));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Blurred name'));
  });

  it('does not fire onRenamePractice when name is unchanged', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AppHeader {...baseProps} onRenamePractice={onRename} />);

    await user.click(screen.getByText('Practice 2026-04-28'));
    const input = screen.getByRole('textbox', { name: /rename practice/i });
    await user.type(input, '{Enter}');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('does not fire onRenamePractice when name is empty after trim', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AppHeader {...baseProps} onRenamePractice={onRename} />);

    await user.click(screen.getByText('Practice 2026-04-28'));
    const input = screen.getByRole('textbox', { name: /rename practice/i });
    await user.clear(input);
    await user.type(input, '   {Enter}');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('rename trigger is a real button reachable via the keyboard', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AppHeader {...baseProps} onRenamePractice={onRename} />);

    const trigger = screen.getByRole('button', { name: 'Practice 2026-04-28' });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    trigger.focus();
    await user.keyboard('{Enter}');
    const input = screen.getByRole('textbox', { name: /rename practice/i });
    await user.clear(input);
    await user.type(input, 'Keyboard name{Enter}');
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Keyboard name'));
  });

  it('rename trigger is disabled when canRename is false', () => {
    render(<AppHeader {...baseProps} canRename={false} />);
    const trigger = screen.getByRole('button', { name: 'Practice 2026-04-28' });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
  });
});
