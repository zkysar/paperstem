import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupsDrawer } from './GroupsDrawer';
import type { BandWithRole } from '../../shared/types';

function setupFetchMock(
  handlers: Record<
    string,
    (url: string, init?: RequestInit) => Response | Promise<Response>
  >,
) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const exact = `${method} ${url}`;
    const handler = handlers[exact] ?? handlers[url];
    if (!handler) throw new Error(`unexpected fetch: ${method} ${url}`);
    return Promise.resolve(handler(url, init));
  });
}

const ownerGroup: BandWithRole = {
  id: 'b1',
  name: 'Sun Toilet',
  folder_id: 'f1',
  owner_user_id: 'u1',
  created_at: 0,
  role: 'owner',
};

const memberGroup: BandWithRole = {
  id: 'b2',
  name: 'Moon Tractor',
  folder_id: 'f2',
  owner_user_id: 'u2',
  created_at: 0,
  role: 'member',
};

function membersResponseFor(groupId: string, body?: object) {
  return new Response(
    JSON.stringify(
      body ?? {
        band: { id: groupId, name: 'whatever', folder_id: 'f', owner_user_id: 'u', created_at: 0 },
        members: [
          { id: 'u1', email: 'owner@example.com', display_name: null, role: 'owner' },
          { id: 'u-self', email: 'self@example.com', display_name: null, role: 'member' },
        ],
      },
    ),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const noopProps = {
  onClose: () => undefined,
  onLeft: () => undefined,
  onCreateGroup: () => undefined,
};

describe('GroupsDrawer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when closed', () => {
    render(
      <GroupsDrawer
        open={false}
        groups={[ownerGroup]}
        currentGroupId="b1"
        {...noopProps}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists every group the user belongs to', async () => {
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
    });
    render(
      <GroupsDrawer
        open={true}
        groups={[ownerGroup, memberGroup]}
        currentGroupId="b1"
        {...noopProps}
      />,
    );
    expect(screen.getByText('Sun Toilet')).not.toBeNull();
    expect(screen.getByText('Moon Tractor')).not.toBeNull();
  });

  it('auto-expands the active group and collapses the others', async () => {
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
    });
    render(
      <GroupsDrawer
        open={true}
        groups={[ownerGroup, memberGroup]}
        currentGroupId="b1"
        {...noopProps}
      />,
    );
    // Active group's body content (Members heading + members) is in the DOM.
    await screen.findByText('owner@example.com');
    // Inactive group's body shouldn't be loaded yet — no Moon Tractor rename
    // button visible.
    expect(screen.queryByRole('button', { name: /Rename Moon Tractor/i })).toBeNull();
  });

  it('clicking a collapsed row expands it and lazy-fetches members', async () => {
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () =>
        membersResponseFor(ownerGroup.id, {
          band: { id: 'b1', name: 'Sun Toilet', folder_id: 'f1', owner_user_id: 'u1', created_at: 0 },
          members: [
            { id: 'u1', email: 'owner@example.com', display_name: null, role: 'owner' },
          ],
        }),
      [`/api/bands/${memberGroup.id}`]: () =>
        membersResponseFor(memberGroup.id, {
          band: { id: 'b2', name: 'Moon Tractor', folder_id: 'f2', owner_user_id: 'u2', created_at: 0 },
          members: [
            { id: 'u-other-owner', email: 'tractor-owner@example.com', display_name: null, role: 'owner' },
            { id: 'u-self', email: 'self@example.com', display_name: null, role: 'member' },
          ],
        }),
    });
    const user = userEvent.setup();
    render(
      <GroupsDrawer
        open={true}
        groups={[ownerGroup, memberGroup]}
        currentGroupId="b1"
        {...noopProps}
      />,
    );
    await user.click(screen.getByText('Moon Tractor'));
    await screen.findByText('tractor-owner@example.com');
  });

  it('shows a "Create a new group" button that fires onCreateGroup', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <GroupsDrawer
        open={true}
        groups={[]}
        currentGroupId={null}
        {...noopProps}
        onCreateGroup={onCreate}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Create a new group/i }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('shows an empty-state hint when the user has no groups', () => {
    render(
      <GroupsDrawer
        open={true}
        groups={[]}
        currentGroupId={null}
        {...noopProps}
      />,
    );
    expect(screen.getByText(/not in any groups yet/i)).not.toBeNull();
  });

  it('Escape closes the drawer', async () => {
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <GroupsDrawer
        open={true}
        groups={[ownerGroup]}
        currentGroupId="b1"
        {...noopProps}
        onClose={onClose}
      />,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('owner row has an invite form; member row does not', async () => {
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () =>
        membersResponseFor(ownerGroup.id, {
          band: { id: 'b1', name: 'Sun Toilet', folder_id: 'f1', owner_user_id: 'u1', created_at: 0 },
          members: [{ id: 'u1', email: 'owner@example.com', display_name: null, role: 'owner' }],
        }),
      [`/api/bands/${memberGroup.id}`]: () =>
        membersResponseFor(memberGroup.id, {
          band: { id: 'b2', name: 'Moon Tractor', folder_id: 'f2', owner_user_id: 'u2', created_at: 0 },
          members: [{ id: 'u-other', email: 'other@example.com', display_name: null, role: 'owner' }],
        }),
    });
    const user = userEvent.setup();
    render(
      <GroupsDrawer
        open={true}
        groups={[ownerGroup, memberGroup]}
        currentGroupId="b1"
        {...noopProps}
      />,
    );
    // Owner row expanded by default — invite form should be present.
    expect(
      screen.getByLabelText(/Invite email for Sun Toilet/i),
    ).not.toBeNull();

    // Expand the member row.
    await user.click(screen.getByText('Moon Tractor'));
    await screen.findByText('other@example.com');
    expect(
      screen.queryByLabelText(/Invite email for Moon Tractor/i),
    ).toBeNull();
  });

  it('member row shows a Leave button; owner row shows the owner-cannot-leave hint', async () => {
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () =>
        membersResponseFor(ownerGroup.id, {
          band: { id: 'b1', name: 'Sun Toilet', folder_id: 'f1', owner_user_id: 'u1', created_at: 0 },
          members: [{ id: 'u1', email: 'owner@example.com', display_name: null, role: 'owner' }],
        }),
      [`/api/bands/${memberGroup.id}`]: () =>
        membersResponseFor(memberGroup.id, {
          band: { id: 'b2', name: 'Moon Tractor', folder_id: 'f2', owner_user_id: 'u2', created_at: 0 },
          members: [{ id: 'u-other', email: 'other@example.com', display_name: null, role: 'owner' }],
        }),
    });
    const user = userEvent.setup();
    render(
      <GroupsDrawer
        open={true}
        groups={[ownerGroup, memberGroup]}
        currentGroupId="b1"
        {...noopProps}
      />,
    );
    expect(screen.getByText(/Owners can't leave their own group/i)).not.toBeNull();

    await user.click(screen.getByText('Moon Tractor'));
    await screen.findByRole('button', { name: /Leave group/i });
  });

  it('leaving a non-active group still calls onLeft with that id', async () => {
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () =>
        membersResponseFor(ownerGroup.id, {
          band: { id: 'b1', name: 'Sun Toilet', folder_id: 'f1', owner_user_id: 'u1', created_at: 0 },
          members: [{ id: 'u1', email: 'owner@example.com', display_name: null, role: 'owner' }],
        }),
      [`/api/bands/${memberGroup.id}`]: () =>
        membersResponseFor(memberGroup.id, {
          band: { id: 'b2', name: 'Moon Tractor', folder_id: 'f2', owner_user_id: 'u2', created_at: 0 },
          members: [{ id: 'u-other', email: 'other@example.com', display_name: null, role: 'owner' }],
        }),
      [`DELETE /api/bands/${memberGroup.id}/members/me`]: () =>
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    const onLeft = vi.fn();
    const user = userEvent.setup();
    render(
      <GroupsDrawer
        open={true}
        groups={[ownerGroup, memberGroup]}
        currentGroupId="b1"
        {...noopProps}
        onLeft={onLeft}
      />,
    );
    await user.click(screen.getByText('Moon Tractor'));
    await user.click(await screen.findByRole('button', { name: /Leave group/i }));
    await user.click(
      screen.getByRole('button', { name: /Leave Moon Tractor/i }),
    );
    await waitFor(() => expect(onLeft).toHaveBeenCalledWith('b2'));
  });

  it('owner can rename a group through the inline editor', async () => {
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
      [`PATCH /api/bands/${ownerGroup.id}`]: () =>
        new Response(
          JSON.stringify({
            band: { id: 'b1', name: 'Renamed', folder_id: 'f1', owner_user_id: 'u1', created_at: 0 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });
    const onRenamed = vi.fn();
    const user = userEvent.setup();
    render(
      <GroupsDrawer
        open={true}
        groups={[ownerGroup]}
        currentGroupId="b1"
        {...noopProps}
        onRenamed={onRenamed}
      />,
    );
    await user.click(
      await screen.findByRole('button', { name: /Rename Sun Toilet/i }),
    );
    const input = screen.getByLabelText('Group name') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'Renamed{Enter}');
    await waitFor(() => expect(onRenamed).toHaveBeenCalledWith('b1', 'Renamed'));
  });

  it('owner can invite a new member', async () => {
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
      [`POST /api/bands/${ownerGroup.id}/members`]: () =>
        new Response(
          JSON.stringify({
            member: {
              id: 'new-user',
              email: 'new@example.com',
              display_name: null,
              role: 'member',
            },
            mailed: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });
    const user = userEvent.setup();
    render(
      <GroupsDrawer
        open={true}
        groups={[ownerGroup]}
        currentGroupId="b1"
        {...noopProps}
      />,
    );
    const input = await screen.findByLabelText(/Invite email for Sun Toilet/i);
    await user.type(input, 'new@example.com');
    await user.click(screen.getByRole('button', { name: /Send invite/i }));
    await screen.findByText(/magic-link email is on the way/i);
    expect(screen.getAllByText('new@example.com').length).toBeGreaterThanOrEqual(1);
  });

  it('owner can remove a non-owner member through confirm flow', async () => {
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
      [`DELETE /api/bands/${ownerGroup.id}/members/u-self`]: () =>
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    const user = userEvent.setup();
    render(
      <GroupsDrawer
        open={true}
        groups={[ownerGroup]}
        currentGroupId="b1"
        {...noopProps}
      />,
    );
    await user.click(
      await screen.findByRole('button', { name: /Remove self@example.com/i }),
    );
    await user.click(screen.getByRole('button', { name: /^Remove$/ }));
    await waitFor(() =>
      expect(screen.queryByText('self@example.com')).toBeNull(),
    );
  });

  it('marks the active group with the "active" pill', async () => {
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
    });
    render(
      <GroupsDrawer
        open={true}
        groups={[ownerGroup, memberGroup]}
        currentGroupId="b1"
        {...noopProps}
      />,
    );
    expect(screen.getByLabelText('active group')).not.toBeNull();
  });
});
