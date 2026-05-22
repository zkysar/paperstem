import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpProjectsRepo } from './projects-repo';

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HttpProjectsRepo.list', () => {
  it('builds /api/projects?band_id=… with credentials', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          projects: [
            {
              id: 'p1',
              name: 'Project One',
              recorded_on: '2026-05-01',
              created_at: 0,
              updated_at: 0,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const repo = new HttpProjectsRepo('band-abc');
    const list = await repo.list();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/projects?band_id=band-abc');
    expect((init as RequestInit).credentials).toBe('include');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'p1', title: 'Project One' });
  });

  it('throws on non-2xx', async () => {
    fetchSpy.mockResolvedValue(new Response('nope', { status: 404 }));
    const repo = new HttpProjectsRepo('band-x');
    await expect(repo.list()).rejects.toThrow(/404/);
  });

  it('url-encodes the band id', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ projects: [] }), { status: 200 }),
    );
    const repo = new HttpProjectsRepo('band/with spaces');
    await repo.list();
    const url = fetchSpy.mock.calls[0][0];
    expect(url).toBe('/api/projects?band_id=band%2Fwith%20spaces');
  });

  it('parses folder_id into folderId', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          projects: [
            {
              id: 'p1',
              name: 'Project One',
              recorded_on: '2026-05-01',
              folder_id: 'folder-xyz',
              created_at: 0,
              updated_at: 0,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const repo = new HttpProjectsRepo('band-abc');
    const list = await repo.list();
    expect(list[0]).toMatchObject({ id: 'p1', folderId: 'folder-xyz' });
  });
});

describe('HttpProjectsRepo.getById', () => {
  it('fetches detail and maps stems to ids', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          project: {
            id: 'p1',
            band_id: 'b1',
            name: 'Project One',
            recorded_on: '2026-05-01',
            folder_id: 'drv',
            notes: null,
            created_at: 0,
            created_by: 'u1',
            updated_at: 0,
          },
          stems: [
            { id: 's1', name: 'drums', position: 0, duration_ms: null, size_bytes: 1 },
            { id: 's2', name: 'bass', position: 1, duration_ms: null, size_bytes: 2 },
          ],
        }),
        { status: 200 },
      ),
    );
    const repo = new HttpProjectsRepo('b1');
    const p = await repo.getById('p1');
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/projects/p1');
    expect(p.id).toBe('p1');
    expect(p.title).toBe('Project One');
    expect(p.stems).toEqual([
      { id: 's1', name: 'drums', durationMs: null },
      { id: 's2', name: 'bass', durationMs: null },
    ]);
    expect(p.folderId).toBe('drv');
  });
});
