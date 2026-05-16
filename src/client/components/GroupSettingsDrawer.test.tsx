import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupSettingsDrawer } from './GroupSettingsDrawer';
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

const membersResponseFor = (groupId: string) =>
  new Response(
    JSON.stringify({
      band: { id: groupId, name: 'whatever', folder_id: 'f', owner_user_id: 'u', created_at: 0 },
      members: [
        { id: 'u1', email: 'owner@example.com', display_name: null, role: 'owner' },
        { id: 'u-self', email: 'self@example.com', display_name: null, role: 'member' },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

describe('GroupSettingsDrawer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when closed', () => {
    render(
      <GroupSettingsDrawer
        open={false}
        group={ownerGroup}
        onClose={() => undefined}
        onLeft={() => undefined}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the group name in the title', async () => {
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={ownerGroup}
        onClose={() => undefined}
        onLeft={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Sun Toilet' })).not.toBeNull();
  });

  it('fetches and shows the member list with roles', async () => {
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={ownerGroup}
        onClose={() => undefined}
        onLeft={() => undefined}
      />,
    );
    await screen.findByText('owner@example.com');
    await screen.findByText('self@example.com');
    // Two role pills.
    expect(screen.getAllByText(/owner/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/member/i).length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT show the Leave button for owners', async () => {
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={ownerGroup}
        onClose={() => undefined}
        onLeft={() => undefined}
      />,
    );
    await screen.findByText('owner@example.com');
    expect(screen.queryByRole('button', { name: /Leave group/i })).toBeNull();
  });

  it('shows the Leave button for non-owner members', async () => {
    setupFetchMock({
      [`/api/bands/${memberGroup.id}`]: () => membersResponseFor(memberGroup.id),
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={memberGroup}
        onClose={() => undefined}
        onLeft={() => undefined}
      />,
    );
    expect(
      await screen.findByRole('button', { name: /Leave group/i }),
    ).not.toBeNull();
  });

  it('confirming Leave fires DELETE and calls onLeft', async () => {
    const onLeft = vi.fn();
    const onClose = vi.fn();
    setupFetchMock({
      [`/api/bands/${memberGroup.id}`]: () => membersResponseFor(memberGroup.id),
      [`DELETE /api/bands/${memberGroup.id}/members/me`]: () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={memberGroup}
        onClose={onClose}
        onLeft={onLeft}
      />,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Leave group/i }));
    await user.click(screen.getByRole('button', { name: /Yes, leave/i }));
    await waitFor(() => expect(onLeft).toHaveBeenCalledOnce());
  });

  it('Cancel from the confirmation returns to the Leave button without calling onLeft', async () => {
    const onLeft = vi.fn();
    setupFetchMock({
      [`/api/bands/${memberGroup.id}`]: () => membersResponseFor(memberGroup.id),
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={memberGroup}
        onClose={() => undefined}
        onLeft={onLeft}
      />,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Leave group/i }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onLeft).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Leave group/i })).not.toBeNull();
  });

  it('surfaces a 409 owner_cannot_leave error inline', async () => {
    const onLeft = vi.fn();
    setupFetchMock({
      [`/api/bands/${memberGroup.id}`]: () => membersResponseFor(memberGroup.id),
      [`DELETE /api/bands/${memberGroup.id}/members/me`]: () =>
        new Response(JSON.stringify({ error: 'owner_cannot_leave' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={memberGroup}
        onClose={() => undefined}
        onLeft={onLeft}
      />,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Leave group/i }));
    await user.click(screen.getByRole('button', { name: /Yes, leave/i }));
    await screen.findByText(/Owners can't leave/i);
    expect(onLeft).not.toHaveBeenCalled();
  });

  it('clicking the scrim closes the drawer; clicking the modal body does not', async () => {
    const onClose = vi.fn();
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={ownerGroup}
        onClose={onClose}
        onLeft={() => undefined}
      />,
    );
    const user = userEvent.setup();
    await screen.findByText('owner@example.com');
    await user.click(screen.getByRole('heading', { name: 'Sun Toilet' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders a no-group fallback when group is null', () => {
    render(
      <GroupSettingsDrawer
        open={true}
        group={null}
        onClose={() => undefined}
        onLeft={() => undefined}
      />,
    );
    expect(screen.getByText(/No group selected/i)).not.toBeNull();
  });
});
