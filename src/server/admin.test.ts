import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-admin-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
const audioRoot = join(tmpDir, 'audio');
process.env.DATABASE_PATH = dbPath;
process.env.PAPERSTEM_AUDIO_ROOT = audioRoot;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';
process.env.PAPERSTEM_SKIP_MAIL = '1';
// Use a distinct gatekeeper email so we don't depend on the prod default.
process.env.PAPERSTEM_GATEKEEPER_EMAIL = 'zach@test.local';

type DbModule = typeof import('./db.js');
type AdminModule = typeof import('./admin.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let adminMod: AdminModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  adminMod = await import('./admin.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.get('/api/admin/allowlist', adminMod.handleListAllowlist);
  app.post('/api/admin/allowlist', adminMod.handleAddAllowlist);
  app.delete('/api/admin/allowlist/:email', adminMod.handleRemoveAllowlist);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function resetTables() {
  dbMod.db.exec(
    'DELETE FROM sessions; DELETE FROM service_allowlist; DELETE FROM users;',
  );
}

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

function cookieHeader(sessionId: string): string {
  return `${cookieMod.SESSION_COOKIE_NAME}=${sessionId}`;
}

beforeEach(() => {
  resetTables();
});

describe('GET /api/admin/allowlist', () => {
  it('requires authentication', async () => {
    const res = await app.fetch(new Request('http://x/api/admin/allowlist'));
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-gatekeeper user', async () => {
    const stranger = createUser('stranger@example.com');
    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request('http://x/api/admin/allowlist', {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns the allowlist for the gatekeeper', async () => {
    const gk = createUser('zach@test.local');
    const sid = createSession(gk);
    dbMod.stmts.insertAllowlistEntry.run(
      'alice@example.com',
      gk,
      Math.floor(Date.now() / 1000),
      'first invite',
    );
    const res = await app.fetch(
      new Request('http://x/api/admin/allowlist', {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: { email: string; note: string | null; added_by_email: string | null }[];
    };
    const alice = body.entries.find((e) => e.email === 'alice@example.com');
    expect(alice).toBeDefined();
    expect(alice?.note).toBe('first invite');
    expect(alice?.added_by_email).toBe('zach@test.local');
  });
});

describe('POST /api/admin/allowlist', () => {
  it('requires authentication', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@example.com' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-gatekeeper user', async () => {
    const stranger = createUser('stranger@example.com');
    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request('http://x/api/admin/allowlist', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ email: 'new@example.com' }),
      }),
    );
    expect(res.status).toBe(403);
    expect(
      dbMod.stmts.findAllowlistEntry.get('new@example.com'),
    ).toBeUndefined();
  });

  it('rejects invalid emails', async () => {
    const gk = createUser('zach@test.local');
    const sid = createSession(gk);
    for (const body of [{ email: '' }, { email: 'not-an-email' }, {}]) {
      const res = await app.fetch(
        new Request('http://x/api/admin/allowlist', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: cookieHeader(sid),
          },
          body: JSON.stringify(body),
        }),
      );
      expect(res.status).toBe(400);
    }
  });

  it('adds an entry on behalf of the gatekeeper', async () => {
    const gk = createUser('zach@test.local');
    const sid = createSession(gk);
    const res = await app.fetch(
      new Request('http://x/api/admin/allowlist', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ email: '  Friend@Example.COM  ', note: 'tour-mate' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      entry: { email: string; added_by_email: string | null; note: string | null };
    };
    expect(body.entry.email).toBe('friend@example.com');
    expect(body.entry.added_by_email).toBe('zach@test.local');
    expect(body.entry.note).toBe('tour-mate');
    const entry = dbMod.stmts.findAllowlistEntry.get('friend@example.com');
    expect(entry?.added_by_user_id).toBe(gk);
  });

  it('treats a whitespace-only note as no note', async () => {
    const gk = createUser('zach@test.local');
    const sid = createSession(gk);
    const res = await app.fetch(
      new Request('http://x/api/admin/allowlist', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ email: 'blank@example.com', note: '   ' }),
      }),
    );
    expect(res.status).toBe(201);
    const entry = dbMod.stmts.findAllowlistEntry.get('blank@example.com');
    expect(entry?.note).toBeNull();
  });

  it('returns 400 for an unparseable JSON body', async () => {
    const gk = createUser('zach@test.local');
    const sid = createSession(gk);
    const res = await app.fetch(
      new Request('http://x/api/admin/allowlist', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: 'not-json',
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/admin/allowlist/:email', () => {
  it('requires authentication', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/allowlist/x@example.com', {
        method: 'DELETE',
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-gatekeeper user', async () => {
    const stranger = createUser('stranger@example.com');
    const sid = createSession(stranger);
    dbMod.stmts.insertAllowlistEntry.run(
      'alice@example.com',
      null,
      Math.floor(Date.now() / 1000),
      null,
    );
    const res = await app.fetch(
      new Request('http://x/api/admin/allowlist/alice@example.com', {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(403);
    expect(
      dbMod.stmts.findAllowlistEntry.get('alice@example.com'),
    ).toBeDefined();
  });

  it('returns 404 for an unknown email', async () => {
    const gk = createUser('zach@test.local');
    const sid = createSession(gk);
    const res = await app.fetch(
      new Request('http://x/api/admin/allowlist/missing@example.com', {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('removes an entry for the gatekeeper', async () => {
    const gk = createUser('zach@test.local');
    const sid = createSession(gk);
    dbMod.stmts.insertAllowlistEntry.run(
      'alice@example.com',
      gk,
      Math.floor(Date.now() / 1000),
      null,
    );
    const res = await app.fetch(
      new Request('http://x/api/admin/allowlist/alice@example.com', {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);
    expect(
      dbMod.stmts.findAllowlistEntry.get('alice@example.com'),
    ).toBeUndefined();
  });
});
