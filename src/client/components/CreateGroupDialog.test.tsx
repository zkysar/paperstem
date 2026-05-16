import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateGroupDialog } from './CreateGroupDialog';

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

describe('CreateGroupDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when closed', () => {
    render(
      <CreateGroupDialog
        open={false}
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables the submit button when the name is empty', () => {
    render(
      <CreateGroupDialog
        open={true}
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    );
    const btn = screen.getByRole('button', {
      name: /Create group/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('submits a trimmed name and fires onCreated with the response band', async () => {
    const onCreated = vi.fn();
    const fakeBand = {
      id: 'b-new',
      name: 'Sun Toilet',
      folder_id: 'folder-x',
      owner_user_id: 'u',
      created_at: 0,
      role: 'owner' as const,
    };
    let receivedBody: string | null = null;
    setupFetchMock({
      'POST /api/bands': (_url, init) => {
        receivedBody = typeof init?.body === 'string' ? init.body : null;
        return new Response(JSON.stringify({ band: fakeBand }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    render(
      <CreateGroupDialog
        open={true}
        onClose={() => undefined}
        onCreated={onCreated}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Group name/i), '  Sun Toilet  ');
    await user.click(screen.getByRole('button', { name: /Create group/i }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(fakeBand));
    expect(receivedBody).toBe(JSON.stringify({ name: 'Sun Toilet' }));
  });

  it('surfaces duplicate_name error inline with a helpful message', async () => {
    setupFetchMock({
      'POST /api/bands': () =>
        new Response(JSON.stringify({ error: 'duplicate_name' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    const onCreated = vi.fn();
    render(
      <CreateGroupDialog
        open={true}
        onClose={() => undefined}
        onCreated={onCreated}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Group name/i), 'Twin');
    await user.click(screen.getByRole('button', { name: /Create group/i }));
    await screen.findByText(/already own a group called "Twin"/i);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('surfaces name_too_long error inline', async () => {
    setupFetchMock({
      'POST /api/bands': () =>
        new Response(JSON.stringify({ error: 'name_too_long' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    render(
      <CreateGroupDialog
        open={true}
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Group name/i), 'longname');
    await user.click(screen.getByRole('button', { name: /Create group/i }));
    await screen.findByText(/80 characters/i);
  });

  it('Escape closes the dialog', async () => {
    const onClose = vi.fn();
    render(
      <CreateGroupDialog
        open={true}
        onClose={onClose}
        onCreated={() => undefined}
      />,
    );
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking the scrim closes the dialog; clicking the body does not', async () => {
    const onClose = vi.fn();
    render(
      <CreateGroupDialog
        open={true}
        onClose={onClose}
        onCreated={() => undefined}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/Group name/i));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('resets the form when reopened', async () => {
    const { rerender } = render(
      <CreateGroupDialog
        open={true}
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Group name/i), 'Draft');
    expect(
      (screen.getByLabelText(/Group name/i) as HTMLInputElement).value,
    ).toBe('Draft');
    rerender(
      <CreateGroupDialog
        open={false}
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    );
    rerender(
      <CreateGroupDialog
        open={true}
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    );
    expect(
      (screen.getByLabelText(/Group name/i) as HTMLInputElement).value,
    ).toBe('');
  });
});
