import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpPracticesRepo } from './practices-repo';

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HttpPracticesRepo.list', () => {
  it('builds /api/practices?band_id=… with credentials', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          practices: [
            {
              id: 'p1',
              name: 'Practice One',
              recorded_on: '2026-05-01',
              created_at: 0,
              updated_at: 0,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const repo = new HttpPracticesRepo('band-abc');
    const list = await repo.list();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/practices?band_id=band-abc');
    expect((init as RequestInit).credentials).toBe('include');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'p1', title: 'Practice One' });
  });

  it('throws on non-2xx', async () => {
    fetchSpy.mockResolvedValue(new Response('nope', { status: 404 }));
    const repo = new HttpPracticesRepo('band-x');
    await expect(repo.list()).rejects.toThrow(/404/);
  });

  it('url-encodes the band id', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ practices: [] }), { status: 200 }),
    );
    const repo = new HttpPracticesRepo('band/with spaces');
    await repo.list();
    const url = fetchSpy.mock.calls[0][0];
    expect(url).toBe('/api/practices?band_id=band%2Fwith%20spaces');
  });

  it('parses drive_folder_id into driveFolderId', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          practices: [
            {
              id: 'p1',
              name: 'Practice One',
              recorded_on: '2026-05-01',
              drive_folder_id: 'drive-xyz',
              created_at: 0,
              updated_at: 0,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const repo = new HttpPracticesRepo('band-abc');
    const list = await repo.list();
    expect(list[0]).toMatchObject({ id: 'p1', driveFolderId: 'drive-xyz' });
  });
});

describe('HttpPracticesRepo.getById', () => {
  it('fetches detail and maps stems to ids', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          practice: {
            id: 'p1',
            band_id: 'b1',
            name: 'Practice One',
            recorded_on: '2026-05-01',
            drive_folder_id: 'drv',
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
    const repo = new HttpPracticesRepo('b1');
    const p = await repo.getById('p1');
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/practices/p1');
    expect(p.id).toBe('p1');
    expect(p.title).toBe('Practice One');
    expect(p.stems).toEqual([
      { id: 's1', name: 'drums' },
      { id: 's2', name: 'bass' },
    ]);
    expect(p.driveFolderId).toBe('drv');
  });
});
