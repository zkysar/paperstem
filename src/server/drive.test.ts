import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csec';
process.env.GOOGLE_REFRESH_TOKEN = 'rtok';

type DriveModule = typeof import('./drive.js');
let drive: DriveModule;

beforeEach(async () => {
  vi.resetModules();
  drive = await import('./drive.js');
  drive._resetTokenCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function tokenResponse(token: string, expiresIn = 3600): Response {
  return new Response(
    JSON.stringify({ access_token: token, expires_in: expiresIn }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('drive token cache', () => {
  it('reuses a single in-flight refresh across concurrent callers', async () => {
    let resolveToken: ((r: Response) => void) | undefined;
    const tokenPromise = new Promise<Response>((res) => {
      resolveToken = res;
    });

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.startsWith('https://oauth2.googleapis.com/token')) {
          return tokenPromise;
        }
        return Promise.resolve(
          new Response('{"id":"x"}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });

    const a = drive.createFolder('a');
    const b = drive.createFolder('b');
    const c = drive.createFolder('c');

    await Promise.resolve();
    resolveToken!(tokenResponse('tok-1'));

    await Promise.all([a, b, c]);

    const tokenCalls = fetchSpy.mock.calls.filter((args) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
      return url.startsWith('https://oauth2.googleapis.com/token');
    });
    expect(tokenCalls).toHaveLength(1);
  });

  it('refreshes again once the cached token is near expiry', async () => {
    const tokenSequence = [tokenResponse('tok-A', 3600), tokenResponse('tok-B', 3600)];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.startsWith('https://oauth2.googleapis.com/token')) {
          const next = tokenSequence.shift();
          if (!next) throw new Error('unexpected token call');
          return Promise.resolve(next);
        }
        return Promise.resolve(
          new Response('{"id":"x"}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });

    await drive.createFolder('first');

    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 3600 * 1000;
      await drive.createFolder('second');
    } finally {
      Date.now = realNow;
    }

    const tokenCalls = fetchSpy.mock.calls.filter((args) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
      return url.startsWith('https://oauth2.googleapis.com/token');
    });
    expect(tokenCalls).toHaveLength(2);
  });

  it('fails fast when GOOGLE_* envs are missing', async () => {
    vi.resetModules();
    const prev = process.env.GOOGLE_REFRESH_TOKEN;
    delete process.env.GOOGLE_REFRESH_TOKEN;
    try {
      const fresh: DriveModule = await import('./drive.js');
      fresh._resetTokenCacheForTests();
      await expect(fresh.createFolder('x')).rejects.toThrow(/GOOGLE_REFRESH_TOKEN/);
    } finally {
      process.env.GOOGLE_REFRESH_TOKEN = prev;
    }
  });
});

describe('renameDriveItem', () => {
  it('PATCHes /files/{id} with the new name', async () => {
    let captured: { url: string; method: string; body: string } | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      captured = {
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : '',
      };
      return new Response('{"id":"f1","name":"new"}', { status: 200 });
    });
    await drive.renameDriveItem('f1', 'new');
    expect(captured!.method).toBe('PATCH');
    expect(captured!.url).toContain('/files/f1');
    expect(JSON.parse(captured!.body)).toEqual({ name: 'new' });
  });
});

describe('trashDriveItem / untrashDriveItem', () => {
  it('PATCHes trashed=true / trashed=false', async () => {
    const calls: { method: string; body: string }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      calls.push({
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : '',
      });
      return new Response('{}', { status: 200 });
    });
    await drive.trashDriveItem('f1');
    await drive.untrashDriveItem('f1');
    expect(JSON.parse(calls[0].body)).toEqual({ trashed: true });
    expect(JSON.parse(calls[1].body)).toEqual({ trashed: false });
  });
});

describe('drive 404 surface', () => {
  it('renameDriveItem on missing file throws DriveNotFoundError', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });
    await expect(drive.renameDriveItem('missing', 'x')).rejects.toBeInstanceOf(
      drive.DriveNotFoundError,
    );
  });
});
