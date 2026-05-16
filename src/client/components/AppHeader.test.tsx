import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { AppHeader } from './AppHeader';

const baseProps = {
  userEmail: 'zach@example.com',
  userInitials: 'ZK',
  projectTitle: 'Project 2026-04-28',
  stemCount: 9,
  duration: 272.5,
  annotationsOpen: false,
  hasProject: true,
  canRename: true,
  isWide: true,
  appVersion: 'test-1.0.0',
  appEnv: null,
  downloading: false,
  debugInfo: '',
  onOpenPicker: vi.fn(),
  onToggleAnnotations: vi.fn(),
  onSignOut: vi.fn(),
  onReportBug: vi.fn(),
  onRenameProject: vi.fn(),
  onOpenTokens: vi.fn(),
  onDownloadAll: vi.fn(),
};

describe('AppHeader', () => {
  it('renders brand and project title', () => {
    render(<AppHeader {...baseProps} />);
    expect(screen.getByText('Paperstem')).not.toBeNull();
    expect(screen.getByText('Project 2026-04-28')).not.toBeNull();
    expect(screen.getByText(/9 stems/)).not.toBeNull();
  });

  it('does not render a standalone Library button anymore', () => {
    render(<AppHeader {...baseProps} />);
    expect(screen.queryByLabelText('Open projects')).toBeNull();
  });

  it('does not render a Drive folder link', () => {
    render(<AppHeader {...baseProps} />);
    expect(screen.queryByLabelText('Open in Drive')).toBeNull();
  });

  it('clicking ▾ caret calls onOpenPicker', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} onOpenPicker={onOpen} />);
    await user.click(screen.getByLabelText('Switch project'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('clicking the title TEXT does NOT call onOpenPicker (reserved for rename)', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} onOpenPicker={onOpen} />);
    await user.click(screen.getByText('Project 2026-04-28'));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('hides 💬 and metadata when no project loaded', () => {
    render(<AppHeader {...baseProps} hasProject={false} projectTitle={null} stemCount={0} duration={0} />);
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

  it('Report a bug item invokes onReportBug and closes the menu', async () => {
    const onReportBug = vi.fn();
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} onReportBug={onReportBug} />);
    await user.click(screen.getByLabelText('Account'));
    await user.click(screen.getByRole('menuitem', { name: /Report a bug/i }));
    expect(onReportBug).toHaveBeenCalledOnce();
    expect(screen.queryByText('zach@example.com')).toBeNull();
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

  it('renders a Download button', () => {
    render(<AppHeader {...baseProps} />);
    expect(screen.getByLabelText('Download all stems')).not.toBeNull();
  });

  it('Download button calls onDownloadAll when clicked', async () => {
    const onDownload = vi.fn();
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} onDownloadAll={onDownload} />);
    await user.click(screen.getByLabelText('Download all stems'));
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it('Download button is disabled when no project loaded', () => {
    render(<AppHeader {...baseProps} hasProject={false} />);
    expect((screen.getByLabelText('Download all stems') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Download button shows a spinner while downloading', () => {
    render(<AppHeader {...baseProps} downloading={true} />);
    const btn = screen.getByLabelText('Download all stems') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.querySelector('.atb-spin')).not.toBeNull();
  });

  it('header comments button has a class that hides it on mobile', () => {
    render(<AppHeader {...baseProps} />);
    const btn = screen.getByLabelText('Toggle comments');
    expect(btn.className).toContain('ah-hide-on-mobile');
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
  it('clicking the project title opens an editable input that submits on Enter', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AppHeader {...baseProps} onRenameProject={onRename} />);

    await user.click(screen.getByText('Project 2026-04-28'));
    const input = screen.getByRole('textbox', { name: /rename project/i });
    await user.clear(input);
    await user.type(input, 'New name{Enter}');

    await waitFor(() => expect(onRename).toHaveBeenCalledWith('New name'));
  });

  it('Escape cancels without firing onRenameProject', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AppHeader {...baseProps} onRenameProject={onRename} />);

    await user.click(screen.getByText('Project 2026-04-28'));
    const input = screen.getByRole('textbox', { name: /rename project/i });
    await user.type(input, 'changed{Escape}');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('does not enter edit mode when canRename is false', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AppHeader {...baseProps} canRename={false} onRenameProject={onRename} />);

    await user.click(screen.getByText('Project 2026-04-28'));
    expect(screen.queryByRole('textbox', { name: /rename project/i })).toBeNull();
  });

  it('blur commits the rename', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <div>
        <AppHeader {...baseProps} onRenameProject={onRename} />
        <button type="button" data-testid="elsewhere">elsewhere</button>
      </div>,
    );

    await user.click(screen.getByText('Project 2026-04-28'));
    const input = screen.getByRole('textbox', { name: /rename project/i });
    await user.clear(input);
    await user.type(input, 'Blurred name');
    await user.click(screen.getByTestId('elsewhere'));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Blurred name'));
  });

  it('does not fire onRenameProject when name is unchanged', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AppHeader {...baseProps} onRenameProject={onRename} />);

    await user.click(screen.getByText('Project 2026-04-28'));
    const input = screen.getByRole('textbox', { name: /rename project/i });
    await user.type(input, '{Enter}');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('does not fire onRenameProject when name is empty after trim', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AppHeader {...baseProps} onRenameProject={onRename} />);

    await user.click(screen.getByText('Project 2026-04-28'));
    const input = screen.getByRole('textbox', { name: /rename project/i });
    await user.clear(input);
    await user.type(input, '   {Enter}');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('rename trigger is a real button reachable via the keyboard', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AppHeader {...baseProps} onRenameProject={onRename} />);

    const trigger = screen.getByRole('button', { name: 'Project 2026-04-28' });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    trigger.focus();
    await user.keyboard('{Enter}');
    const input = screen.getByRole('textbox', { name: /rename project/i });
    await user.clear(input);
    await user.type(input, 'Keyboard name{Enter}');
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Keyboard name'));
  });

  it('renders an "Open a project" CTA instead of a title when no project is loaded', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} hasProject={false} projectTitle={null} onOpenPicker={onOpen} />);
    expect(screen.queryByRole('button', { name: 'Project 2026-04-28' })).toBeNull();
    expect(screen.queryByLabelText('Switch project')).toBeNull();
    const cta = screen.getByRole('button', { name: /Open a project/i });
    await user.click(cta);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('on mobile, clicking the project title opens the picker (no inline rename)', async () => {
    const onOpen = vi.fn();
    const onRename = vi.fn();
    const user = userEvent.setup();
    render(
      <AppHeader
        {...baseProps}
        isWide={false}
        onOpenPicker={onOpen}
        onRenameProject={onRename}
      />,
    );
    await user.click(screen.getByText('Project 2026-04-28'));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.queryByRole('textbox', { name: /rename project/i })).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
  });

  it('on desktop, clicking the title still opens the inline rename input', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} isWide={true} onOpenPicker={onOpen} />);
    await user.click(screen.getByText('Project 2026-04-28'));
    expect(screen.getByRole('textbox', { name: /rename project/i })).not.toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('AppHeader group switcher', () => {
  const groups = [
    { id: 'b1', name: 'Sun Toilet', folder_id: 'f1', owner_user_id: 'u1', created_at: 0, role: 'owner' as const },
    { id: 'b2', name: 'Moon Tractor', folder_id: 'f2', owner_user_id: 'u2', created_at: 0, role: 'member' as const },
  ];

  it('does not render the switcher when the user is in 0 groups', () => {
    render(<AppHeader {...baseProps} groups={[]} currentGroupId={null} />);
    expect(screen.queryByLabelText('Switch group')).toBeNull();
  });

  it('does not render the switcher when the user is in exactly 1 group', () => {
    render(<AppHeader {...baseProps} groups={[groups[0]!]} currentGroupId="b1" />);
    expect(screen.queryByLabelText('Switch group')).toBeNull();
  });

  it('renders the current group name when there are 2+ groups', () => {
    render(<AppHeader {...baseProps} groups={groups} currentGroupId="b1" />);
    expect(screen.getByLabelText('Switch group')).not.toBeNull();
    expect(screen.getByText('Sun Toilet')).not.toBeNull();
  });

  it('opens a menu listing every group, marking the current one with aria-current', async () => {
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} groups={groups} currentGroupId="b1" />);
    await user.click(screen.getByLabelText('Switch group'));
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
    expect(items[0]!.getAttribute('aria-current')).toBe('true');
    expect(items[1]!.getAttribute('aria-current')).toBeNull();
  });

  it('clicking a different group calls onSwitchGroup and closes the menu', async () => {
    const onSwitch = vi.fn();
    const user = userEvent.setup();
    render(
      <AppHeader
        {...baseProps}
        groups={groups}
        currentGroupId="b1"
        onSwitchGroup={onSwitch}
      />,
    );
    await user.click(screen.getByLabelText('Switch group'));
    await user.click(screen.getByRole('menuitem', { name: /Moon Tractor/ }));
    expect(onSwitch).toHaveBeenCalledWith('b2');
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('clicking the current group does NOT call onSwitchGroup but still closes the menu', async () => {
    const onSwitch = vi.fn();
    const user = userEvent.setup();
    render(
      <AppHeader
        {...baseProps}
        groups={groups}
        currentGroupId="b1"
        onSwitchGroup={onSwitch}
      />,
    );
    await user.click(screen.getByLabelText('Switch group'));
    await user.click(screen.getByRole('menuitem', { name: /Sun Toilet/ }));
    expect(onSwitch).not.toHaveBeenCalled();
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('falls back to the first group when currentGroupId does not match any', () => {
    render(<AppHeader {...baseProps} groups={groups} currentGroupId="b-missing" />);
    expect(screen.getByText('Sun Toilet')).not.toBeNull();
  });

  it('avatar menu shows "Group settings" when onOpenGroupSettings is wired and a group is selected', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(
      <AppHeader
        {...baseProps}
        groups={groups}
        currentGroupId="b1"
        onOpenGroupSettings={onOpen}
      />,
    );
    await user.click(screen.getByLabelText('Account'));
    const item = screen.getByRole('menuitem', { name: /Group settings/i });
    await user.click(item);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('avatar menu hides "Group settings" when onOpenGroupSettings prop is absent', async () => {
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} groups={groups} currentGroupId="b1" />);
    await user.click(screen.getByLabelText('Account'));
    expect(screen.queryByRole('menuitem', { name: /Group settings/i })).toBeNull();
  });

  it('Escape closes the open menu', async () => {
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} groups={groups} currentGroupId="b1" />);
    await user.click(screen.getByLabelText('Switch group'));
    expect(screen.queryAllByRole('menuitem')).toHaveLength(2);
    await user.keyboard('{Escape}');
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('"+ New group" entry is hidden when onCreateGroup is absent', async () => {
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} groups={groups} currentGroupId="b1" />);
    await user.click(screen.getByLabelText('Switch group'));
    expect(screen.queryByRole('menuitem', { name: /New group/i })).toBeNull();
  });

  it('"+ New group" appears when onCreateGroup is wired and triggers it', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <AppHeader
        {...baseProps}
        groups={groups}
        currentGroupId="b1"
        onCreateGroup={onCreate}
      />,
    );
    await user.click(screen.getByLabelText('Switch group'));
    const item = screen.getByRole('menuitem', { name: /New group/i });
    await user.click(item);
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('clicking outside closes the open menu', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <AppHeader {...baseProps} groups={groups} currentGroupId="b1" />
        <div data-testid="outside">outside</div>
      </div>,
    );
    await user.click(screen.getByLabelText('Switch group'));
    expect(screen.getByRole('menuitem', { name: /Sun Toilet/ })).not.toBeNull();
    await user.click(screen.getByTestId('outside'));
    expect(screen.queryByRole('menuitem')).toBeNull();
  });
});
