import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-trash-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csec';
process.env.GOOGLE_REFRESH_TOKEN = 'rtok';

type DbModule = typeof import('./db.js');
type TrashModule = typeof import('./trash.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let trashMod: TrashModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  trashMod = await import('./trash.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.get('/api/bands/:id/trash', trashMod.handleListTrash);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  dbMod.db.exec(
    'DELETE FROM stems; DELETE FROM practices; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
  vi.restoreAllMocks();
}

beforeEach(() => {
  reset();
});

function createUser(email: string): string {
  const id = randomUUID();
  dbMod.stmts.insertUser.run(id, email, null, Math.floor(Date.now() / 1000));
  return id;
}

function createBand(name: string, ownerId: string): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertBand.run(id, name, 'drive-folder-x', ownerId, now);
  dbMod.stmts.insertMembership.run(id, ownerId, 'owner', now);
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

describe('GET /api/bands/:id/trash', () => {
  it('lists soft-deleted practices and stems for the band', async () => {
    const userId = createUser('alice@example.com');
    const bandId = createBand('B', userId);
    const sessionId = createSession(userId);
    const now = Math.floor(Date.now() / 1000);

    const livePid = randomUUID();
    dbMod.stmts.insertPractice.run(livePid, bandId, 'live', null, 'fld', null, now, userId, now);
    const trashedPid = randomUUID();
    dbMod.stmts.insertPractice.run(trashedPid, bandId, 'trashed', null, 'fld-t', null, now, userId, now);
    dbMod.stmts.softDeletePractice.run(now, userId, trashedPid);

    const liveSid = randomUUID();
    dbMod.stmts.insertStem.run(liveSid, livePid, 'live.wav', 0, 'sd1', null, null, null);
    const trashedSid = randomUUID();
    dbMod.stmts.insertStem.run(trashedSid, livePid, 'trashed.wav', 1, 'sd2', null, null, null);
    dbMod.stmts.softDeleteStem.run(now, userId, trashedSid);

    const res = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/trash`, {
        headers: { Cookie: cookieHeader(sessionId) },
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json() as {
      practices: Array<{ id: string; name: string; deleted_reason: string }>;
      stems: Array<{ id: string; name: string; deleted_reason: string; practice_name: string }>;
    };
    expect(data.practices.map((p) => p.id)).toEqual([trashedPid]);
    expect(data.stems.map((s) => s.id)).toEqual([trashedSid]);
    expect(data.stems[0].practice_name).toBe('live');
  });

  it('lazy-purges rows older than 30 days', async () => {
    const userId = createUser('alice@example.com');
    const bandId = createBand('B', userId);
    const sessionId = createSession(userId);
    const now = Math.floor(Date.now() / 1000);
    const oldDeletedAt = now - 31 * 24 * 60 * 60;

    const oldPid = randomUUID();
    dbMod.stmts.insertPractice.run(oldPid, bandId, 'old', null, 'fld', null, now, userId, now);
    dbMod.stmts.softDeletePractice.run(oldDeletedAt, userId, oldPid);

    const recentPid = randomUUID();
    dbMod.stmts.insertPractice.run(recentPid, bandId, 'recent', null, 'fld', null, now, userId, now);
    dbMod.stmts.softDeletePractice.run(now, userId, recentPid);

    const res = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/trash`, {
        headers: { Cookie: cookieHeader(sessionId) },
      })
    );
    expect(res.status).toBe(200);

    expect(dbMod.stmts.findPracticeAnyState.get(oldPid)).toBeUndefined();
    expect(dbMod.stmts.findPracticeAnyState.get(recentPid)).toBeDefined();
  });

  it('returns 404 for non-members', async () => {
    const ownerId = createUser('owner@example.com');
    const otherId = createUser('other@example.com');
    const bandId = createBand('B', ownerId);
    const otherSession = createSession(otherId);

    const res = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/trash`, {
        headers: { Cookie: cookieHeader(otherSession) },
      })
    );
    expect(res.status).toBe(404);
  });
});
