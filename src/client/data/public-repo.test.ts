import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeMembership } from './public-repo';

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
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('probeMembership', () => {
  it('returns "anonymous" when /api/me returns 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const out = await probeMembership('proj-1');
    expect(out).toEqual({ kind: 'anonymous' });
    // We don't call /api/projects when /api/me didn't yield a user.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns "anonymous" when /api/me returns a null user', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ user: null }));
    expect(await probeMembership('proj-1')).toEqual({ kind: 'anonymous' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns "signed-in-member" when /api/projects/:id returns 200', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'u1' } }))
      .mockResolvedValueOnce(jsonResponse({ project: { id: 'proj-1' } }));
    expect(await probeMembership('proj-1')).toEqual({ kind: 'signed-in-member' });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/projects/proj-1',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('returns "signed-in-non-member" when /api/projects/:id returns 404 (no leak)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'u1' } }))
      .mockResolvedValueOnce(jsonResponse({ error: 'not_found' }, 404));
    expect(await probeMembership('proj-1')).toEqual({
      kind: 'signed-in-non-member',
    });
  });

  it('falls back to "anonymous" when /api/me throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('net'));
    expect(await probeMembership('proj-1')).toEqual({ kind: 'anonymous' });
  });

  it('encodes the project id into the URL', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'u1' } }))
      .mockResolvedValueOnce(jsonResponse({ project: { id: 'p' } }));
    await probeMembership('p/with/slash');
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/projects/p%2Fwith%2Fslash',
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
