import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-stems-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csec';
process.env.GOOGLE_REFRESH_TOKEN = 'rtok';

type DbModule = typeof import('./db.js');
type StemsModule = typeof import('./stems.js');
type DriveModule = typeof import('./drive.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let stemsMod: StemsModule;
let driveMod: DriveModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  stemsMod = await import('./stems.js');
  driveMod = await import('./drive.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.patch('/api/stems/:id', stemsMod.handleRenameStem);
  app.delete('/api/stems/:id', stemsMod.handleDeleteStem);
  app.post('/api/stems/:id/restore', stemsMod.handleRestoreStem);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  dbMod.db.exec(
    'DELETE FROM stems; DELETE FROM practices; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
  driveMod._resetTokenCacheForTests();
  vi.restoreAllMocks();
}

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

function createPracticeAndStem(
  bandId: string,
  ownerId: string,
  stemName: string,
): { practiceId: string; stemId: string; driveFileId: string } {
  const practiceId = randomUUID();
  const stemId = randomUUID();
  const driveFileId = `drive-${stemId}`;
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertPractice.run(
    practiceId,
    bandId,
    'p1',
    '2026-05-01',
    'practice-folder',
    null,
    now,
    ownerId,
    now,
  );
  dbMod.stmts.insertStem.run(stemId, practiceId, stemName, 0, driveFileId, null, 1024);
  return { practiceId, stemId, driveFileId };
}

beforeEach(() => {
  reset();
});

function tokenResponse(): Response {
  return new Response(
    JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('PATCH /api/stems/:id', () => {
  it('renames stem and PATCHes Drive file with the new name', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { stemId, driveFileId } = createPracticeAndStem(bandId, owner, 'old.wav');
    const sid = createSession(owner);

    const captured: { url: string; method: string; body: unknown }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return tokenResponse();
      }
      const method = (init?.method ?? 'GET').toUpperCase();
      let parsedBody: unknown = undefined;
      if (init?.body && typeof init.body === 'string') {
        try {
          parsedBody = JSON.parse(init.body);
        } catch {
          parsedBody = init.body;
        }
      }
      captured.push({ url, method, body: parsedBody });
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}`, {
        method: 'PATCH',
        headers: {
          Cookie: cookieHeader(sid),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'new.wav' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; name: string };
    expect(body).toMatchObject({ ok: true, name: 'new.wav' });

    const driveCalls = captured.filter((c) => c.method === 'PATCH');
    expect(driveCalls.length).toBe(1);
    expect(driveCalls[0]!.url).toContain(`/files/${driveFileId}`);
    expect(driveCalls[0]!.body).toEqual({ name: 'new.wav' });

    const row = dbMod.stmts.findStemById.get(stemId)!;
    expect(row.name).toBe('new.wav');
  });

  it('returns 200 even if Drive PATCH responds 500 (DB still updates)', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { stemId } = createPracticeAndStem(bandId, owner, 'old.wav');
    const sid = createSession(owner);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return tokenResponse();
      }
      return new Response('boom', { status: 500 });
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}`, {
        method: 'PATCH',
        headers: {
          Cookie: cookieHeader(sid),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'renamed.wav' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalled();

    const row = dbMod.stmts.findStemById.get(stemId)!;
    expect(row.name).toBe('renamed.wav');
  });

  it('rejects empty or oversized names with 400', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { stemId } = createPracticeAndStem(bandId, owner, 'original.wav');
    const sid = createSession(owner);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const emptyRes = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}`, {
        method: 'PATCH',
        headers: {
          Cookie: cookieHeader(sid),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: '' }),
      }),
    );
    expect(emptyRes.status).toBe(400);

    const bigRes = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}`, {
        method: 'PATCH',
        headers: {
          Cookie: cookieHeader(sid),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'x'.repeat(201) }),
      }),
    );
    expect(bigRes.status).toBe(400);

    expect(fetchSpy).not.toHaveBeenCalled();
    const row = dbMod.stmts.findStemById.get(stemId)!;
    expect(row.name).toBe('original.wav');
  });

  it('rejects non-members with 404', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const { stemId } = createPracticeAndStem(bandId, owner, 'original.wav');
    const sid = createSession(stranger);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}`, {
        method: 'PATCH',
        headers: {
          Cookie: cookieHeader(sid),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'new.wav' }),
      }),
    );
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();

    const row = dbMod.stmts.findStemById.get(stemId)!;
    expect(row.name).toBe('original.wav');
  });
});

describe('DELETE /api/stems/:id', () => {
  it('soft-deletes the stem and trashes the Drive file', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { stemId } = createPracticeAndStem(bandId, owner, 'drums.wav');
    const sid = createSession(owner);

    const captured: { url: string; method: string; body: unknown }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return tokenResponse();
      }
      const method = (init?.method ?? 'GET').toUpperCase();
      let parsedBody: unknown = undefined;
      if (init?.body && typeof init.body === 'string') {
        try {
          parsedBody = JSON.parse(init.body);
        } catch {
          parsedBody = init.body;
        }
      }
      captured.push({ url, method, body: parsedBody });
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);

    const driveCalls = captured.filter((c) => c.method === 'PATCH');
    expect(driveCalls.length).toBe(1);
    expect(driveCalls[0]!.body).toEqual({ trashed: true });

    expect(dbMod.stmts.findStemById.get(stemId)).toBeUndefined();
    const row = dbMod.stmts.findStemAnyState.get(stemId)!;
    expect(row.deleted_at).toBeGreaterThan(0);
    expect(row.deleted_by).toBe(owner);
    expect(row.deleted_reason).toBe('user');
  });

  it('rejects non-members with 404', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const { stemId } = createPracticeAndStem(bandId, owner, 'drums.wav');
    const sid = createSession(stranger);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();

    const row = dbMod.stmts.findStemAnyState.get(stemId)!;
    expect(row.deleted_at).toBeNull();
  });
});

describe('POST /api/stems/:id/restore', () => {
  it('restores soft-deleted stem and untrashes Drive file', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { stemId } = createPracticeAndStem(bandId, owner, 'drums.wav');
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.softDeleteStem.run(now, owner, stemId);
    const sid = createSession(owner);

    const captured: { url: string; method: string; body: unknown }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return tokenResponse();
      }
      const method = (init?.method ?? 'GET').toUpperCase();
      let parsedBody: unknown = undefined;
      if (init?.body && typeof init.body === 'string') {
        try {
          parsedBody = JSON.parse(init.body);
        } catch {
          parsedBody = init.body;
        }
      }
      captured.push({ url, method, body: parsedBody });
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}/restore`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);

    const driveCalls = captured.filter((c) => c.method === 'PATCH');
    expect(driveCalls.length).toBe(1);
    expect(driveCalls[0]!.body).toEqual({ trashed: false });

    const row = dbMod.stmts.findStemById.get(stemId)!;
    expect(row).toBeDefined();
    expect(row.deleted_at).toBeNull();
  });

  it('returns 409 for ghost rows (drive_missing)', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { stemId } = createPracticeAndStem(bandId, owner, 'drums.wav');
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.markStemGhost.run(now, stemId);
    const sid = createSession(owner);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}/restore`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();

    const row = dbMod.stmts.findStemAnyState.get(stemId)!;
    expect(row.deleted_reason).toBe('drive_missing');
  });

  it('rejects non-members with 404', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const { stemId } = createPracticeAndStem(bandId, owner, 'drums.wav');
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.softDeleteStem.run(now, owner, stemId);
    const sid = createSession(stranger);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}/restore`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
