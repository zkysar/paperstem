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
  currentProjectId: null,
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

  it('on mobile, avatar menu surfaces Download all stems and fires onDownloadAll', async () => {
    const onDownload = vi.fn();
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} isWide={false} onDownloadAll={onDownload} />);
    await user.click(screen.getByLabelText('Account'));
    const item = screen.getByRole('menuitem', { name: /Download all stems/i });
    await user.click(item);
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it('on mobile, the Download menu entry is disabled while a download is in flight', async () => {
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} isWide={false} downloading={true} />);
    await user.click(screen.getByLabelText('Account'));
    const item = screen.getByRole('menuitem', { name: /Downloading/i }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
  });

  it('on mobile, avatar menu has a Comments toggle that fires onToggleAnnotations', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} isWide={false} onToggleAnnotations={onToggle} />);
    await user.click(screen.getByLabelText('Account'));
    const item = screen.getByRole('menuitem', { name: /Open comments/i });
    await user.click(item);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('on mobile with the panel open, the Comments menu entry reads "Close comments"', async () => {
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} isWide={false} annotationsOpen={true} />);
    await user.click(screen.getByLabelText('Account'));
    expect(screen.getByRole('menuitem', { name: /Close comments/i })).not.toBeNull();
  });

  it('on desktop, the avatar menu does NOT surface Download or Comments items', async () => {
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} isWide={true} />);
    await user.click(screen.getByLabelText('Account'));
    expect(screen.queryByRole('menuitem', { name: /Download all stems/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Open comments/i })).toBeNull();
  });

  it('on mobile with no project, avatar menu does NOT surface Download or Comments items', async () => {
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} isWide={false} hasProject={false} projectTitle={null} />);
    await user.click(screen.getByLabelText('Account'));
    expect(screen.queryByRole('menuitem', { name: /Download all stems/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Open comments/i })).toBeNull();
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

  it('does not render the switcher when the user is in 0 groups', async () => {
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} groups={[]} currentGroupId={null} />);
    await user.click(screen.getByLabelText('Account'));
    expect(screen.queryByText('Switch group')).toBeNull();
  });

  it('renders the switcher when the user is in exactly 1 group (gives "+ New group" a stable home)', async () => {
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} groups={[groups[0]!]} currentGroupId="b1" onCreateGroup={vi.fn()} />);
    await user.click(screen.getByLabelText('Account'));
    expect(screen.getByText('Switch group')).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /Sun Toilet/ })).not.toBeNull();
  });

  it('hides the switcher with 1 group when onCreateGroup is absent (no inert single-item list)', async () => {
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} groups={[groups[0]!]} currentGroupId="b1" />);
    await user.click(screen.getByLabelText('Account'));
    expect(screen.queryByText('Switch group')).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Sun Toilet/ })).toBeNull();
  });

  it('with 1 group and onCreateGroup, the avatar menu has the current group + a "+ New group" entry', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <AppHeader
        {...baseProps}
        groups={[groups[0]!]}
        currentGroupId="b1"
        onCreateGroup={onCreate}
      />,
    );
    await user.click(screen.getByLabelText('Account'));
    const current = screen.getByRole('menuitem', { name: /Sun Toilet/ });
    expect(current.getAttribute('aria-current')).toBe('true');
    await user.click(screen.getByRole('menuitem', { name: /New group/i }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('renders the current group name when there are 2+ groups', async () => {
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} groups={groups} currentGroupId="b1" />);
    await user.click(screen.getByLabelText('Account'));
    expect(screen.getByText('Switch group')).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /Sun Toilet/ })).not.toBeNull();
  });

  it('lists every group, marking the current one with aria-current', async () => {
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} groups={groups} currentGroupId="b1" />);
    await user.click(screen.getByLabelText('Account'));
    const sun = screen.getByRole('menuitem', { name: /Sun Toilet/ });
    const moon = screen.getByRole('menuitem', { name: /Moon Tractor/ });
    expect(sun.getAttribute('aria-current')).toBe('true');
    expect(moon.getAttribute('aria-current')).toBeNull();
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
    await user.click(screen.getByLabelText('Account'));
    await user.click(screen.getByRole('menuitem', { name: /Moon Tractor/ }));
    expect(onSwitch).toHaveBeenCalledWith('b2');
    expect(screen.queryByRole('menuitem', { name: /Sun Toilet/ })).toBeNull();
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
    await user.click(screen.getByLabelText('Account'));
    await user.click(screen.getByRole('menuitem', { name: /Sun Toilet/ }));
    expect(onSwitch).not.toHaveBeenCalled();
    expect(screen.queryByRole('menuitem', { name: /Sun Toilet/ })).toBeNull();
  });

  it('falls back to the first group when currentGroupId does not match any', async () => {
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} groups={groups} currentGroupId="b-missing" />);
    await user.click(screen.getByLabelText('Account'));
    const sun = screen.getByRole('menuitem', { name: /Sun Toilet/ });
    expect(sun.getAttribute('aria-current')).toBe('true');
  });

  it('avatar menu shows "Groups" when onOpenGroups is wired and fires it', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(
      <AppHeader
        {...baseProps}
        groups={groups}
        currentGroupId="b1"
        onOpenGroups={onOpen}
      />,
    );
    await user.click(screen.getByLabelText('Account'));
    const item = screen.getByRole('menuitem', { name: /^Groups$/i });
    await user.click(item);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('avatar menu hides "Groups" when onOpenGroups prop is absent', async () => {
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} groups={groups} currentGroupId="b1" />);
    await user.click(screen.getByLabelText('Account'));
    expect(screen.queryByRole('menuitem', { name: /^Groups$/i })).toBeNull();
  });

  it('avatar menu shows "Groups" even when the user has no current group (so they can still create one)', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(
      <AppHeader
        {...baseProps}
        groups={[]}
        currentGroupId={null}
        onOpenGroups={onOpen}
      />,
    );
    await user.click(screen.getByLabelText('Account'));
    expect(screen.getByRole('menuitem', { name: /^Groups$/i })).not.toBeNull();
  });

  it('Escape closes the open menu', async () => {
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} groups={groups} currentGroupId="b1" />);
    await user.click(screen.getByLabelText('Account'));
    expect(screen.getByRole('menuitem', { name: /Sun Toilet/ })).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menuitem', { name: /Sun Toilet/ })).toBeNull();
  });

  it('"+ New group" entry is hidden when onCreateGroup is absent', async () => {
    const user = userEvent.setup();
    render(<AppHeader {...baseProps} groups={groups} currentGroupId="b1" />);
    await user.click(screen.getByLabelText('Account'));
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
    await user.click(screen.getByLabelText('Account'));
    const item = screen.getByRole('menuitem', { name: /New group/i });
    await user.click(item);
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('on mobile, the avatar menu surfaces the same group switcher (one consolidated home)', async () => {
    const onSwitch = vi.fn();
    const user = userEvent.setup();
    render(
      <AppHeader
        {...baseProps}
        groups={groups}
        currentGroupId="b1"
        onSwitchGroup={onSwitch}
        isWide={false}
      />,
    );
    await user.click(screen.getByLabelText('Account'));
    expect(screen.getByRole('menuitem', { name: /Sun Toilet/ })).not.toBeNull();
    const moon = screen.getByRole('menuitem', { name: /Moon Tractor/ });
    await user.click(moon);
    expect(onSwitch).toHaveBeenCalledWith('b2');
  });

  it('on mobile with no project, avatar menu STILL surfaces the group switcher (no-project lockout regression)', async () => {
    const onSwitch = vi.fn();
    const user = userEvent.setup();
    render(
      <AppHeader
        {...baseProps}
        isWide={false}
        hasProject={false}
        projectTitle={null}
        groups={groups}
        currentGroupId="b1"
        onSwitchGroup={onSwitch}
      />,
    );
    await user.click(screen.getByLabelText('Account'));
    // The Switch group section appears regardless of whether a project is loaded.
    const moon = screen.getByRole('menuitem', { name: /Moon Tractor/ });
    await user.click(moon);
    expect(onSwitch).toHaveBeenCalledWith('b2');
  });

  it('on mobile, "+ New group" works inside the avatar menu even when no project is loaded', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <AppHeader
        {...baseProps}
        groups={[groups[0]!]}
        currentGroupId="b1"
        onCreateGroup={onCreate}
        isWide={false}
        hasProject={false}
        projectTitle={null}
      />,
    );
    await user.click(screen.getByLabelText('Account'));
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
    await user.click(screen.getByLabelText('Account'));
    expect(screen.getByRole('menuitem', { name: /Sun Toilet/ })).not.toBeNull();
    await user.click(screen.getByTestId('outside'));
    expect(screen.queryByRole('menuitem', { name: /Sun Toilet/ })).toBeNull();
  });

  describe('publicMode (the /p/<token> page)', () => {
    it('replaces the avatar with a Sign in button that calls onSignIn', async () => {
      const onSignIn = vi.fn();
      const user = userEvent.setup();
      render(
        <AppHeader
          {...baseProps}
          publicMode={{ onSignIn }}
        />,
      );
      expect(screen.queryByLabelText('Account')).toBeNull();
      const btn = screen.getByRole('button', { name: /Sign in/i });
      await user.click(btn);
      expect(onSignIn).toHaveBeenCalledOnce();
    });

    it('hides the switch-project caret and the group switcher', () => {
      const groups = [
        { id: 'b1', name: 'Sun Toilet', folder_id: '', owner_user_id: 'u1', created_at: 0, role: 'owner' as const },
        { id: 'b2', name: 'Moon Floor', folder_id: '', owner_user_id: 'u1', created_at: 0, role: 'owner' as const },
      ];
      render(
        <AppHeader
          {...baseProps}
          groups={groups}
          currentGroupId="b1"
          publicMode={{ onSignIn: vi.fn() }}
        />,
      );
      expect(screen.queryByLabelText('Switch project')).toBeNull();
      expect(screen.queryByText('Switch group')).toBeNull();
      expect(screen.queryByRole('menuitem', { name: /Sun Toilet/ })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: /Moon Floor/ })).toBeNull();
    });

    it('renders the title as a non-interactive label (not a button)', () => {
      render(
        <AppHeader
          {...baseProps}
          publicMode={{ onSignIn: vi.fn() }}
        />,
      );
      // Behavioural assertion: no button surfaces the project title (so
      // clicks can't trigger project-switching). Survives the underlying
      // tag changing from span→div etc.
      expect(
        screen.queryByRole('button', { name: 'Project 2026-04-28' }),
      ).toBeNull();
      expect(screen.getByText('Project 2026-04-28')).not.toBeNull();
    });

    it('uses the optional label override for signed-in non-members', () => {
      render(
        <AppHeader
          {...baseProps}
          publicMode={{ onSignIn: vi.fn(), label: 'No access' }}
        />,
      );
      expect(screen.getByRole('button', { name: /No access/i })).not.toBeNull();
      expect(screen.queryByRole('button', { name: /^Sign in$/i })).toBeNull();
    });
  });
});
