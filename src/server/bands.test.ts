import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-bands-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('./db.js');
type BandsModule = typeof import('./bands.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let bandsMod: BandsModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  bandsMod = await import('./bands.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.get('/api/bands', bandsMod.handleListBands);
  app.get('/api/bands/:id', bandsMod.handleGetBand);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function resetTables() {
  dbMod.db.exec(
    'DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
}

function createUser(email: string): string {
  const id = randomUUID();
  dbMod.stmts.insertUser.run(id, email, null, Math.floor(Date.now() / 1000));
  return id;
}

function createBand(name: string, ownerId: string, folderId = 'folder-x') {
  const id = randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertBand.run(id, name, folderId, ownerId, createdAt);
  dbMod.stmts.insertMembership.run(id, ownerId, 'owner', createdAt);
  return id;
}

function addMember(bandId: string, userId: string) {
  dbMod.stmts.insertMembership.run(
    bandId,
    userId,
    'member',
    Math.floor(Date.now() / 1000),
  );
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

describe('GET /api/bands', () => {
  it('requires authentication', async () => {
    const res = await app.fetch(new Request('http://x/api/bands'));
    expect(res.status).toBe(401);
  });

  it("returns the calling user's bands with role", async () => {
    const owner = createUser('owner@example.com');
    const member = createUser('member@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, member);
    createBand('Other', stranger);

    const sid = createSession(member);
    const res = await app.fetch(
      new Request('http://x/api/bands', {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bands: { id: string; role: string }[] };
    expect(body.bands).toHaveLength(1);
    expect(body.bands[0].id).toBe(bandId);
    expect(body.bands[0].role).toBe('member');
  });

  it('returns empty list when user has no bands', async () => {
    const u = createUser('lonely@example.com');
    const sid = createSession(u);
    const res = await app.fetch(
      new Request('http://x/api/bands', {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bands: unknown[] };
    expect(body.bands).toEqual([]);
  });
});

describe('GET /api/bands/:id', () => {
  it('requires authentication', async () => {
    const res = await app.fetch(new Request('http://x/api/bands/anything'));
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members (does not leak existence)', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Secret Society', owner);

    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-existent band', async () => {
    const u = createUser('u@example.com');
    const sid = createSession(u);
    const res = await app.fetch(
      new Request('http://x/api/bands/does-not-exist', {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns band detail with members when caller is a member', async () => {
    const owner = createUser('owner@example.com');
    const member = createUser('member@example.com');
    const bandId = createBand('Alpha', owner, 'folder-abc');
    addMember(bandId, member);

    const sid = createSession(member);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      band: { id: string; name: string; folder_id: string };
      members: { email: string; role: string }[];
    };
    expect(body.band.id).toBe(bandId);
    expect(body.band.name).toBe('Alpha');
    expect(body.band.folder_id).toBe('folder-abc');
    expect(body.members).toHaveLength(2);
    const emails = body.members.map((m) => m.email).sort();
    expect(emails).toEqual(['member@example.com', 'owner@example.com']);
    const ownerEntry = body.members.find(
      (m) => m.email === 'owner@example.com',
    );
    expect(ownerEntry?.role).toBe('owner');
  });
});
