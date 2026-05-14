import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-dev-login-test-'));
process.env.DATABASE_PATH = join(tmpDir, 'test.sqlite');
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('../db.js');
type DevLoginModule = typeof import('./dev-login.js');
type CookieModule = typeof import('./cookie.js');

let dbMod: DbModule;
let devLoginMod: DevLoginModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

const ORIGINAL_AUTO_LOGIN = process.env.PAPERSTEM_DEV_AUTO_LOGIN;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeAll(async () => {
  dbMod = await import('../db.js');
  devLoginMod = await import('./dev-login.js');
  cookieMod = await import('./cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.get('/api/auth/dev-login', devLoginMod.handleDevLogin);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  dbMod.db.exec(
    'DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
});

afterEach(() => {
  if (ORIGINAL_AUTO_LOGIN === undefined) delete process.env.PAPERSTEM_DEV_AUTO_LOGIN;
  else process.env.PAPERSTEM_DEV_AUTO_LOGIN = ORIGINAL_AUTO_LOGIN;
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('GET /api/auth/dev-login', () => {
  it('returns 404 when env var is unset', async () => {
    delete process.env.PAPERSTEM_DEV_AUTO_LOGIN;
    const res = await app.fetch(new Request('http://x/api/auth/dev-login'));
    expect(res.status).toBe(404);
  });

  it('returns 404 when NODE_ENV is production', async () => {
    process.env.PAPERSTEM_DEV_AUTO_LOGIN = 'dev@example.com';
    process.env.NODE_ENV = 'production';
    const res = await app.fetch(new Request('http://x/api/auth/dev-login'));
    expect(res.status).toBe(404);
  });

  it('creates user, session, and redirects when enabled', async () => {
    process.env.PAPERSTEM_DEV_AUTO_LOGIN = 'Dev@Example.com';
    process.env.NODE_ENV = 'development';
    const res = await app.fetch(new Request('http://x/api/auth/dev-login'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(cookieMod.SESSION_COOKIE_NAME);

    const user = dbMod.stmts.findUserByEmail.get('dev@example.com');
    expect(user).toBeDefined();
    expect(user?.email).toBe('dev@example.com');
  });

  it('reuses existing user on subsequent calls', async () => {
    process.env.PAPERSTEM_DEV_AUTO_LOGIN = 'dev@example.com';
    process.env.NODE_ENV = 'development';

    const r1 = await app.fetch(new Request('http://x/api/auth/dev-login'));
    expect(r1.status).toBe(302);
    const u1 = dbMod.stmts.findUserByEmail.get('dev@example.com');

    const r2 = await app.fetch(new Request('http://x/api/auth/dev-login'));
    expect(r2.status).toBe(302);
    const u2 = dbMod.stmts.findUserByEmail.get('dev@example.com');

    expect(u2?.id).toBe(u1?.id);
    const sessionCount = dbMod.db
      .prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?')
      .get(u1!.id) as { n: number };
    expect(sessionCount.n).toBe(2);
  });
});
