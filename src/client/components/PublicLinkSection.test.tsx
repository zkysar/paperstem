import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicLinkSection } from './PublicLinkSection';

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      origin: 'https://paperstem.app',
      pathname: '/',
      href: 'https://paperstem.app/',
    },
  });
  window.confirm = vi.fn(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PublicLinkSection', () => {
  it('shows a Create button when no live links exist', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ links: [] }));
    render(<PublicLinkSection projectId="proj-1" />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Create public link/i }),
      ).not.toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/proj-1/public-links',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('creates a public link and shows the /p/<token> URL', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ links: [] }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            link: {
              token: 'pls_abc123',
              created_at: 1,
              created_by_email: 'me@example.com',
              revoked_at: null,
              last_accessed_at: null,
            },
          },
          201,
        ),
      );
    render(<PublicLinkSection projectId="proj-1" />);

    const create = await screen.findByRole('button', {
      name: /Create public link/i,
    });
    await userEvent.click(create);

    await waitFor(() => {
      const input = screen.getByLabelText(/Public link URL/i) as HTMLInputElement;
      expect(input.value).toBe('https://paperstem.app/p/pls_abc123');
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/projects/proj-1/public-links',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('lists existing live links and hides revoked ones', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        links: [
          {
            token: 'pls_live',
            created_at: 1,
            created_by_email: 'a@b.com',
            revoked_at: null,
            last_accessed_at: null,
          },
          {
            token: 'pls_dead',
            created_at: 2,
            created_by_email: 'a@b.com',
            revoked_at: 999,
            last_accessed_at: null,
          },
        ],
      }),
    );
    render(<PublicLinkSection projectId="proj-1" />);

    await waitFor(() => {
      expect(
        (screen.getByLabelText(/Public link URL/i) as HTMLInputElement).value,
      ).toContain('pls_live');
    });
    expect(
      (screen.getByLabelText(/Public link URL/i) as HTMLInputElement).value,
    ).not.toContain('pls_dead');
  });

  it('revokes a link and removes it from the live list', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          links: [
            {
              token: 'pls_live',
              created_at: 1,
              created_by_email: 'a@b.com',
              revoked_at: null,
              last_accessed_at: null,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    render(<PublicLinkSection projectId="proj-1" />);
    const revoke = await screen.findByRole('button', { name: /Revoke/i });
    await userEvent.click(revoke);

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /Revoke/i }),
      ).toBeNull();
    });
    expect(
      screen.getByRole('button', { name: /Create public link/i }),
    ).not.toBeNull();
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/public-links/pls_live',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    );
  });
});
