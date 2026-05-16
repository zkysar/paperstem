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
    await user.click(screen.getByRole('button', { name: /Leave Moon Tractor/i }));
    await waitFor(() => expect(onLeft).toHaveBeenCalledWith(memberGroup.id));
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
    await user.click(screen.getByRole('button', { name: /Leave Moon Tractor/i }));
    await screen.findByText(/owner of this group/i);
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

  it('Escape closes the drawer', async () => {
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
    await screen.findByText('owner@example.com');
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows the "owners cannot leave" hint for owners and hides the Leave button', async () => {
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
    expect(screen.queryByRole('button', { name: /Leave group/i })).toBeNull();
    expect(
      screen.getByText(/Owners can't leave their own group/i),
    ).not.toBeNull();
  });

  it('owner sees the invite form and can add a member', async () => {
    let invitedBody: string | null = null;
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
      [`POST /api/bands/${ownerGroup.id}/members`]: (_url, init) => {
        invitedBody = typeof init?.body === 'string' ? init.body : null;
        return new Response(
          JSON.stringify({
            member: {
              id: 'u-fresh',
              email: 'fresh@example.com',
              display_name: null,
              role: 'member',
            },
            mailed: true,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={ownerGroup}
        onClose={() => undefined}
        onLeft={() => undefined}
      />,
    );
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText(/Invite email/i),
      '  FRESH@example.com  ',
    );
    await user.click(screen.getByRole('button', { name: /Send invite/i }));
    await screen.findByText(/Added/i);
    expect(invitedBody).toBe(JSON.stringify({ email: 'fresh@example.com' }));
    // Member list updates in-place — there's one in the success line and
    // one in the row, so just assert that the row count grew.
    expect(screen.getAllByText('fresh@example.com').length).toBeGreaterThanOrEqual(1);
  });

  it('non-owner does NOT see the invite form', async () => {
    setupFetchMock({
      [`/api/bands/${memberGroup.id}`]: () =>
        membersResponseFor(memberGroup.id),
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={memberGroup}
        onClose={() => undefined}
        onLeft={() => undefined}
      />,
    );
    await screen.findByText('owner@example.com');
    expect(screen.queryByLabelText(/Invite email/i)).toBeNull();
  });

  it('surfaces already_member error from the invite endpoint', async () => {
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
      [`POST /api/bands/${ownerGroup.id}/members`]: () =>
        new Response(JSON.stringify({ error: 'already_member' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={ownerGroup}
        onClose={() => undefined}
        onLeft={() => undefined}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Invite email/i), 'dup@example.com');
    await user.click(screen.getByRole('button', { name: /Send invite/i }));
    await screen.findByText(/already in this group/i);
  });

  it('surfaces bad_email error inline', async () => {
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
      [`POST /api/bands/${ownerGroup.id}/members`]: () =>
        new Response(JSON.stringify({ error: 'bad_email' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={ownerGroup}
        onClose={() => undefined}
        onLeft={() => undefined}
      />,
    );
    const user = userEvent.setup();
    // Use a syntactically-OK address (so the browser's type=email
    // validation lets the form submit) and let the mock pretend the
    // server rejected it with bad_email.
    await user.type(
      screen.getByLabelText(/Invite email/i),
      'foo@example.com',
    );
    await user.click(screen.getByRole('button', { name: /Send invite/i }));
    await screen.findByText(/valid email/i);
  });

  it('shows "no email was sent" hint when mailed is false', async () => {
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
      [`POST /api/bands/${ownerGroup.id}/members`]: () =>
        new Response(
          JSON.stringify({
            member: {
              id: 'u',
              email: 'm@example.com',
              display_name: null,
              role: 'member',
            },
            mailed: false,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={ownerGroup}
        onClose={() => undefined}
        onLeft={() => undefined}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Invite email/i), 'm@example.com');
    await user.click(screen.getByRole('button', { name: /Send invite/i }));
    await screen.findByText(/No email was sent/i);
  });

  it('owner can rename the group; non-owners cannot', async () => {
    const onRenamed = vi.fn();
    let patchBody: string | null = null;
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
      [`PATCH /api/bands/${ownerGroup.id}`]: (_url, init) => {
        patchBody = typeof init?.body === 'string' ? init.body : null;
        return new Response(
          JSON.stringify({
            band: {
              id: ownerGroup.id,
              name: 'Sun Toilet Deluxe',
              folder_id: 'f',
              owner_user_id: 'u',
              created_at: 0,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={ownerGroup}
        onClose={() => undefined}
        onLeft={() => undefined}
        onRenamed={onRenamed}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Rename group'));
    const input = screen.getByLabelText('Group name');
    await user.clear(input);
    await user.type(input, 'Sun Toilet Deluxe{Enter}');
    await waitFor(() =>
      expect(onRenamed).toHaveBeenCalledWith(
        ownerGroup.id,
        'Sun Toilet Deluxe',
      ),
    );
    expect(patchBody).toBe(JSON.stringify({ name: 'Sun Toilet Deluxe' }));
  });

  it('non-owner does not see the Rename pencil', async () => {
    setupFetchMock({
      [`/api/bands/${memberGroup.id}`]: () =>
        membersResponseFor(memberGroup.id),
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={memberGroup}
        onClose={() => undefined}
        onLeft={() => undefined}
      />,
    );
    await screen.findByText('owner@example.com');
    expect(screen.queryByLabelText('Rename group')).toBeNull();
  });

  it('rename surfaces duplicate_name error and does NOT call onRenamed', async () => {
    const onRenamed = vi.fn();
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
      [`PATCH /api/bands/${ownerGroup.id}`]: () =>
        new Response(JSON.stringify({ error: 'duplicate_name' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={ownerGroup}
        onClose={() => undefined}
        onLeft={() => undefined}
        onRenamed={onRenamed}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Rename group'));
    const input = screen.getByLabelText('Group name');
    await user.clear(input);
    await user.type(input, 'Twin{Enter}');
    await screen.findByText(/already own a group called "Twin"/i);
    expect(onRenamed).not.toHaveBeenCalled();
  });

  it('rename Escape cancels without firing PATCH', async () => {
    const onRenamed = vi.fn();
    const fetchSpy = vi.fn();
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
      [`PATCH /api/bands/${ownerGroup.id}`]: () => {
        fetchSpy();
        return new Response('{}', { status: 200 });
      },
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={ownerGroup}
        onClose={() => undefined}
        onLeft={() => undefined}
        onRenamed={onRenamed}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Rename group'));
    const input = screen.getByLabelText('Group name');
    await user.clear(input);
    await user.type(input, 'Something{Escape}');
    expect(onRenamed).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('owner sees a remove (×) button on non-owner rows but NOT on the owner row', async () => {
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
    await screen.findByText('self@example.com');
    expect(screen.getByLabelText(/Remove self@example.com/i)).not.toBeNull();
    expect(screen.queryByLabelText(/Remove owner@example.com/i)).toBeNull();
  });

  it('confirming the × call DELETEs and removes the row optimistically', async () => {
    let deletedUrl: string | null = null;
    setupFetchMock({
      [`/api/bands/${ownerGroup.id}`]: () => membersResponseFor(ownerGroup.id),
      [`DELETE /api/bands/${ownerGroup.id}/members/u-self`]: (url) => {
        deletedUrl = url;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={ownerGroup}
        onClose={() => undefined}
        onLeft={() => undefined}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByLabelText(/Remove self@example.com/i),
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(deletedUrl).toContain('/members/u-self'));
    await waitFor(() =>
      expect(screen.queryByText('self@example.com')).toBeNull(),
    );
  });

  it('non-owner does not see remove × buttons', async () => {
    setupFetchMock({
      [`/api/bands/${memberGroup.id}`]: () =>
        membersResponseFor(memberGroup.id),
    });
    render(
      <GroupSettingsDrawer
        open={true}
        group={memberGroup}
        onClose={() => undefined}
        onLeft={() => undefined}
      />,
    );
    await screen.findByText('owner@example.com');
    expect(
      screen.queryByLabelText(/Remove self@example.com/i),
    ).toBeNull();
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
