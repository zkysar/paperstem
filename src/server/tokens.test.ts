import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-tokens-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('./db.js');
type TokensModule = typeof import('./tokens.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let tokensMod: TokensModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  tokensMod = await import('./tokens.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.get('/api/me/tokens', tokensMod.handleListTokens);
  app.post('/api/me/tokens', tokensMod.handleCreateToken);
  app.delete('/api/me/tokens/:id', tokensMod.handleRevokeToken);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  dbMod.db.exec(
    'DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
});

function createUser(email: string): string {
  const id = randomUUID();
  dbMod.stmts.insertUser.run(id, email, null, Math.floor(Date.now() / 1000));
  return id;
}

function createSession(userId: string): string {
  const sid = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertSession.run(sid, userId, now + 3600, now);
  return sid;
}

function cookieHeader(sid: string): string {
  return `${cookieMod.SESSION_COOKIE_NAME}=${sid}`;
}

describe('tokens routes', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.request('/api/me/tokens');
    expect(res.status).toBe(401);
  });

  it('lists tokens (empty by default)', async () => {
    const uid = createUser('u@example.com');
    const sid = createSession(uid);
    const res = await app.request('/api/me/tokens', {
      headers: { Cookie: cookieHeader(sid) },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tokens: [] });
  });

  it('creates a token and returns the value exactly once', async () => {
    const uid = createUser('u@example.com');
    const sid = createSession(uid);
    const res = await app.request('/api/me/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(sid),
      },
      body: JSON.stringify({ label: 'mbp importer' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      token: { id: string; label: string; created_at: number };
      cookie_name: string;
      cookie_value: string;
    };
    expect(body.token.label).toBe('mbp importer');
    expect(body.cookie_value).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(body.cookie_name).toBe(cookieMod.SESSION_COOKIE_NAME);

    const listRes = await app.request('/api/me/tokens', {
      headers: { Cookie: cookieHeader(sid) },
    });
    const listed = (await listRes.json()) as {
      tokens: Array<{ id: string; label: string }>;
    };
    expect(listed.tokens).toHaveLength(1);
    expect(listed.tokens[0]!.label).toBe('mbp importer');
    expect(JSON.stringify(listed)).not.toContain(body.cookie_value);
  });

  it('rejects creation with missing or empty label', async () => {
    const uid = createUser('u@example.com');
    const sid = createSession(uid);
    for (const body of [{}, { label: '' }, { label: '   ' }]) {
      const res = await app.request('/api/me/tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader(sid),
        },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });

  it('revokes a token by id', async () => {
    const uid = createUser('u@example.com');
    const sid = createSession(uid);
    const createRes = await app.request('/api/me/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(sid),
      },
      body: JSON.stringify({ label: 'to delete' }),
    });
    const { token } = (await createRes.json()) as { token: { id: string } };
    const delRes = await app.request(
      `/api/me/tokens/${encodeURIComponent(token.id)}`,
      {
        method: 'DELETE',
        headers: { Cookie: cookieHeader(sid) },
      },
    );
    expect(delRes.status).toBe(204);
    const listRes = await app.request('/api/me/tokens', {
      headers: { Cookie: cookieHeader(sid) },
    });
    expect(
      ((await listRes.json()) as { tokens: unknown[] }).tokens,
    ).toHaveLength(0);
  });

  it('cannot revoke a token belonging to another user', async () => {
    const u1 = createUser('u1@example.com');
    const u2 = createUser('u2@example.com');
    const s1 = createSession(u1);
    const s2 = createSession(u2);
    const createRes = await app.request('/api/me/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(s2),
      },
      body: JSON.stringify({ label: 'others token' }),
    });
    const { token } = (await createRes.json()) as { token: { id: string } };
    const delRes = await app.request(
      `/api/me/tokens/${encodeURIComponent(token.id)}`,
      {
        method: 'DELETE',
        headers: { Cookie: cookieHeader(s1) },
      },
    );
    expect(delRes.status).toBe(404);
  });
});
