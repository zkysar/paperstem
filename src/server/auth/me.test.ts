import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-me-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('../db.js');
type MeModule = typeof import('./me.js');
type MiddlewareModule = typeof import('./middleware.js');
type CookieModule = typeof import('./cookie.js');

let dbMod: DbModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono<{ Variables: import('./middleware.js').AuthVariables }>;

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_AUTO_LOGIN = process.env.PAPERSTEM_DEV_AUTO_LOGIN;

beforeAll(async () => {
  dbMod = await import('../db.js');
  const meMod: MeModule = await import('./me.js');
  middlewareMod = await import('./middleware.js');
  cookieMod = await import('./cookie.js');
  const { Hono } = await import('hono');
  app = new Hono<{ Variables: import('./middleware.js').AuthVariables }>();
  app.use('*', middlewareMod.sessionMiddleware);
  app.get('/api/me', meMod.handleMe);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function createUser(email: string): string {
  const id = randomUUID();
  dbMod.stmts.insertUser.run(id, email, null, Math.floor(Date.now() / 1000));
  return id;
}

function createSession(userId: string, expiresInSeconds = 3600): string {
  const sid = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertSession.run(sid, userId, now + expiresInSeconds, now);
  return sid;
}

function cookieHeader(sid: string): string {
  return `${cookieMod.SESSION_COOKIE_NAME}=${sid}`;
}

function reset() {
  dbMod.db.exec('DELETE FROM sessions; DELETE FROM users;');
}

beforeEach(() => {
  reset();
  // Ensure dev login is disabled by default so tests are predictable.
  delete process.env.PAPERSTEM_DEV_AUTO_LOGIN;
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  if (ORIGINAL_AUTO_LOGIN === undefined) delete process.env.PAPERSTEM_DEV_AUTO_LOGIN;
  else process.env.PAPERSTEM_DEV_AUTO_LOGIN = ORIGINAL_AUTO_LOGIN;
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('handleMe', () => {
  it('returns 200 with { user: null } when no cookie is present', async () => {
    const res = await app.request('/api/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: null; devLoginUrl?: string };
    expect(body.user).toBeNull();
    expect(body.devLoginUrl).toBeUndefined();
  });

  it('returns 200 with { user: null } for an unknown session id', async () => {
    const res = await app.request('/api/me', {
      headers: { cookie: cookieHeader(randomUUID()) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: null };
    expect(body.user).toBeNull();
  });

  it('returns 200 with { user: null } for an expired session', async () => {
    const userId = createUser('expired@example.com');
    const sid = createSession(userId, -1);
    const res = await app.request('/api/me', {
      headers: { cookie: cookieHeader(sid) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: null };
    expect(body.user).toBeNull();
  });

  it('returns 200 with { user } for a valid session', async () => {
    const userId = createUser('me@example.com');
    const sid = createSession(userId);
    const res = await app.request('/api/me', {
      headers: { cookie: cookieHeader(sid) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string; email: string } };
    expect(body.user).toMatchObject({ id: userId, email: 'me@example.com' });
  });

  it('includes devLoginUrl in the { user: null } body when dev login is enabled', async () => {
    process.env.PAPERSTEM_DEV_AUTO_LOGIN = 'dev@example.com';
    process.env.NODE_ENV = 'development';
    const res = await app.request('/api/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: null; devLoginUrl?: string };
    expect(body.user).toBeNull();
    expect(body.devLoginUrl).toBe('/api/auth/dev-login');
  });

  it('omits devLoginUrl from the { user: null } body when NODE_ENV is production', async () => {
    process.env.PAPERSTEM_DEV_AUTO_LOGIN = 'dev@example.com';
    process.env.NODE_ENV = 'production';
    const res = await app.request('/api/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: null; devLoginUrl?: string };
    expect(body.user).toBeNull();
    expect(body.devLoginUrl).toBeUndefined();
  });
});
