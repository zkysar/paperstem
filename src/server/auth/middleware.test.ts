import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-middleware-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csec';
process.env.GOOGLE_REFRESH_TOKEN = 'rtok';

type DbModule = typeof import('../db.js');
type MiddlewareModule = typeof import('./middleware.js');
type CookieModule = typeof import('./cookie.js');

let dbMod: DbModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('../db.js');
  middlewareMod = await import('./middleware.js');
  cookieMod = await import('./cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.get('/probe', (c) => {
    return c.json({ user: c.var.user, sessionId: c.var.sessionId });
  });
  app.get('/require', (c) => {
    const user = middlewareMod.requireUser(c);
    return c.json({ id: user.id });
  });
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
});

describe('sessionMiddleware', () => {
  it('sets user and sessionId to null when no cookie is present', async () => {
    const res = await app.request('/probe');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: unknown; sessionId: unknown };
    expect(body.user).toBeNull();
    expect(body.sessionId).toBeNull();
  });

  it('sets user and sessionId to null for an unknown sessionId', async () => {
    const res = await app.request('/probe', {
      headers: { cookie: cookieHeader(randomUUID()) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: unknown; sessionId: unknown };
    expect(body.user).toBeNull();
    expect(body.sessionId).toBeNull();
  });

  it('sets user and sessionId to null for an expired session', async () => {
    const userId = createUser('expired@example.com');
    const sid = createSession(userId, -1);
    const res = await app.request('/probe', {
      headers: { cookie: cookieHeader(sid) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: unknown; sessionId: unknown };
    expect(body.user).toBeNull();
    expect(body.sessionId).toBeNull();
  });

  it('populates user and sessionId for a valid session', async () => {
    const userId = createUser('valid@example.com');
    const sid = createSession(userId);
    const res = await app.request('/probe', {
      headers: { cookie: cookieHeader(sid) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string; email: string; display_name: string | null };
      sessionId: string;
    };
    expect(body.user).toMatchObject({ id: userId, email: 'valid@example.com' });
    expect(body.sessionId).toBe(sid);
  });

  it('touches last_used_at when the session was last used more than 60 seconds ago', async () => {
    const userId = createUser('touch@example.com');
    const sid = createSession(userId);
    // Force last_used_at to 0 so the rate-limit guard allows an update.
    dbMod.db.prepare('UPDATE sessions SET last_used_at = 0 WHERE id = ?').run(sid);

    await app.request('/probe', {
      headers: { cookie: cookieHeader(sid) },
    });

    const row = dbMod.db
      .prepare('SELECT last_used_at FROM sessions WHERE id = ?')
      .get(sid) as { last_used_at: number };
    expect(row.last_used_at).toBeGreaterThan(0);
  });
});

describe('requireUser', () => {
  it('returns the user id when a valid session is present', async () => {
    const userId = createUser('auth@example.com');
    const sid = createSession(userId);
    const res = await app.request('/require', {
      headers: { cookie: cookieHeader(sid) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(userId);
  });

  it('throws 401 with { error: "unauthenticated" } when no session is present', async () => {
    const res = await app.request('/require');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: 'unauthenticated' });
  });
});
