import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TokensDrawer } from './TokensDrawer';

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

describe('TokensDrawer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders empty state when there are no tokens', async () => {
    setupFetchMock({
      '/api/me/tokens': () =>
        new Response(JSON.stringify({ tokens: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    render(<TokensDrawer open={true} onClose={() => undefined} />);
    await screen.findByText(/no import tokens/i);
  });

  it('lists existing tokens', async () => {
    setupFetchMock({
      '/api/me/tokens': () =>
        new Response(
          JSON.stringify({
            tokens: [
              {
                id: 'tk_a',
                label: 'mbp importer',
                created_at: 1715551200,
                last_used_at: null,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });
    render(<TokensDrawer open={true} onClose={() => undefined} />);
    await screen.findByText('mbp importer');
  });

  it('creates a new token and shows the value once', async () => {
    let tokens: Array<{
      id: string;
      label: string;
      created_at: number;
      last_used_at: number | null;
    }> = [];
    setupFetchMock({
      'GET /api/me/tokens': () =>
        new Response(JSON.stringify({ tokens }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      'POST /api/me/tokens': () => {
        tokens = [
          {
            id: 'tk_new',
            label: 'new one',
            created_at: 1,
            last_used_at: null,
          },
        ];
        return new Response(
          JSON.stringify({
            token: tokens[0],
            cookie_name: 'paperstem_session_dev',
            cookie_value: 'secret-value-123',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });
    render(<TokensDrawer open={true} onClose={() => undefined} />);
    await screen.findByText(/no import tokens/i);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /create new token/i }),
    );
    await user.type(screen.getByLabelText(/label/i), 'new one');
    await user.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => screen.getByText('secret-value-123'));
    expect(screen.getByText(/only time you'll see this/i)).not.toBeNull();
  });
});
