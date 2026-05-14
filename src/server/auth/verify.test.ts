import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-verify-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('../db.js');
type MiddlewareModule = typeof import('./middleware.js');
type VerifyModule = typeof import('./verify.js');
type CookieModule = typeof import('./cookie.js');

let dbMod: DbModule;
let middlewareMod: MiddlewareModule;
let verifyMod: VerifyModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('../db.js');
  middlewareMod = await import('./middleware.js');
  verifyMod = await import('./verify.js');
  cookieMod = await import('./cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.post('/api/auth/verify', middlewareMod.sessionMiddleware, verifyMod.handleAuthVerify);
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

function createMagicLink(email: string): string {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Math.floor(Date.now() / 1000) + 900;
  dbMod.stmts.insertMagicLink.run(token, email, expiresAt);
  return token;
}

function cookieHeader(sid: string): string {
  return `${cookieMod.SESSION_COOKIE_NAME}=${sid}`;
}

function reset() {
  dbMod.db.exec('DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;');
}

beforeEach(() => {
  reset();
});

async function postVerify(body: unknown, cookie?: string): Promise<Response> {
  return app.request('/api/auth/verify', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('handleAuthVerify', () => {
  it('returns 401 for a missing token (POST {})', async () => {
    const res = await postVerify({});
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: 'invalid_or_expired' });
  });

  it('returns 401 for an empty-string token', async () => {
    const res = await postVerify({ token: '' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: 'invalid_or_expired' });
  });

  it('returns 401 for a non-string token', async () => {
    const res = await postVerify({ token: 123 });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: 'invalid_or_expired' });
  });

  it('returns 401 for an unknown token (no magic_links row)', async () => {
    const res = await postVerify({ token: 'no-such-token' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: 'invalid_or_expired' });
  });

  it("returns 401 when the token's email doesn't match any user", async () => {
    const token = createMagicLink('ghost@example.com');
    // No user inserted for ghost@example.com
    const res = await postVerify({ token });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: 'invalid_or_expired' });
  });

  it('returns 200 with the user payload for a valid token', async () => {
    createUser('alice@example.com');
    const token = createMagicLink('alice@example.com');
    const res = await postVerify({ token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string; email: string; display_name: string | null } };
    expect(body.user).toMatchObject({ email: 'alice@example.com' });
    expect(typeof body.user.id).toBe('string');
  });

  it('sets a session cookie on success', async () => {
    createUser('bob@example.com');
    const token = createMagicLink('bob@example.com');
    const res = await postVerify({ token });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(cookieMod.SESSION_COOKIE_NAME);
  });

  it('inserts a sessions row with the correct user_id and a ~30-day expiry', async () => {
    const userId = createUser('carol@example.com');
    const token = createMagicLink('carol@example.com');
    const nowSec = Math.floor(Date.now() / 1000);
    const res = await postVerify({ token });
    expect(res.status).toBe(200);

    const rows = dbMod.db
      .prepare<[], { id: string; user_id: string; expires_at: number }>(
        'SELECT id, user_id, expires_at FROM sessions',
      )
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(userId);
    expect(rows[0].expires_at).toBeGreaterThanOrEqual(nowSec + 29 * 86400);
    expect(rows[0].expires_at).toBeLessThanOrEqual(nowSec + 31 * 86400);
  });

  it('returns 409 with { error: "already_authenticated" } when the request has a valid session cookie', async () => {
    const userId = createUser('dave@example.com');
    const sid = createSession(userId);
    const res = await postVerify({}, cookieHeader(sid));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: 'already_authenticated' });
  });

  it('is single-use: a second POST with the same token returns 401', async () => {
    createUser('eve@example.com');
    const token = createMagicLink('eve@example.com');

    const first = await postVerify({ token });
    expect(first.status).toBe(200);

    const second = await postVerify({ token });
    expect(second.status).toBe(401);
    const body = (await second.json()) as { error: string };
    expect(body).toEqual({ error: 'invalid_or_expired' });
  });
});
