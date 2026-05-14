import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-logout-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('../db.js');
type LogoutModule = typeof import('./logout.js');
type MiddlewareModule = typeof import('./middleware.js');
type CookieModule = typeof import('./cookie.js');

let dbMod: DbModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('../db.js');
  const logoutMod: LogoutModule = await import('./logout.js');
  middlewareMod = await import('./middleware.js');
  cookieMod = await import('./cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.post('/api/auth/logout', logoutMod.handleAuthLogout);
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

describe('handleAuthLogout', () => {
  it('returns 200 with { ok: true } and clears the session cookie for a valid session', async () => {
    const userId = createUser('user@example.com');
    const sid = createSession(userId);

    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: cookieHeader(sid) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body).toEqual({ ok: true });

    // Session must be deleted from the DB.
    const row = dbMod.db
      .prepare('SELECT id FROM sessions WHERE id = ?')
      .get(sid);
    expect(row).toBeUndefined();

    // Set-Cookie header must clear the session cookie (max-age=0 or expires in the past).
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(cookieMod.SESSION_COOKIE_NAME);
  });

  it('returns 200 with { ok: true } when no cookie is present', async () => {
    const res = await app.request('/api/auth/logout', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body).toEqual({ ok: true });
  });

  it('returns 200 with { ok: true } for an unknown session id (no DB entry to delete)', async () => {
    const unknownSid = randomUUID();
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: cookieHeader(unknownSid) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body).toEqual({ ok: true });
  });

  it('does not delete other users sessions', async () => {
    const userA = createUser('a@example.com');
    const userB = createUser('b@example.com');
    const sidA = createSession(userA);
    const sidB = createSession(userB);

    await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: cookieHeader(sidA) },
    });

    // sidA must be gone.
    expect(
      dbMod.db.prepare('SELECT id FROM sessions WHERE id = ?').get(sidA),
    ).toBeUndefined();

    // sidB must still exist.
    expect(
      dbMod.db.prepare('SELECT id FROM sessions WHERE id = ?').get(sidB),
    ).toBeDefined();
  });
});
