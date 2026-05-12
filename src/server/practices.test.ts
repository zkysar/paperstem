import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-practices-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csec';
process.env.GOOGLE_REFRESH_TOKEN = 'rtok';

type DbModule = typeof import('./db.js');
type PracticesModule = typeof import('./practices.js');
type DriveModule = typeof import('./drive.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let practicesMod: PracticesModule;
let driveMod: DriveModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  practicesMod = await import('./practices.js');
  driveMod = await import('./drive.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.get('/api/practices', practicesMod.handleListPractices);
  app.get('/api/practices/:id', practicesMod.handleGetPractice);
  app.patch('/api/practices/:id', practicesMod.handleRenamePractice);
  app.delete('/api/practices/:id', practicesMod.handleDeletePractice);
  app.post('/api/practices/:id/restore', practicesMod.handleRestorePractice);
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

function insertPractice(
  bandId: string,
  ownerId: string,
  name: string,
  recordedOn: string | null,
): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertPractice.run(
    id,
    bandId,
    name,
    recordedOn,
    'practice-folder',
    null,
    now,
    ownerId,
    now,
  );
  return id;
}

function insertStem(practiceId: string, name: string, position: number): string {
  const id = randomUUID();
  dbMod.stmts.insertStem.run(id, practiceId, name, position, `drive-${id}`, null, 1024, null);
  return id;
}

beforeEach(() => {
  reset();
});

describe('GET /api/practices', () => {
  it('returns 401 unauthenticated', async () => {
    const res = await app.fetch(new Request('http://x/api/practices?band_id=any'));
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    insertPractice(bandId, owner, 'p1', '2026-05-01');

    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/practices?band_id=${bandId}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns practices sorted by recorded_on desc', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    insertPractice(bandId, owner, 'older', '2026-04-01');
    insertPractice(bandId, owner, 'newer', '2026-05-01');

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/practices?band_id=${bandId}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { practices: { name: string }[] };
    expect(body.practices.map((p) => p.name)).toEqual(['newer', 'older']);
  });

  it('returns drive_folder_id on each row', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    insertPractice(bandId, owner, 'p1', '2026-05-01');

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/practices?band_id=${bandId}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      practices: { name: string; drive_folder_id: string | null }[];
    };
    expect(body.practices[0]).toMatchObject({
      name: 'p1',
      drive_folder_id: 'practice-folder',
    });
  });
});

describe('GET /api/practices/:id', () => {
  it('returns 404 for non-members (no leak)', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertPractice(bandId, owner, 'p1', '2026-05-01');

    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/practices/${pid}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns practice with stems but never drive_file_id', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertPractice(bandId, owner, 'p1', '2026-05-01');
    insertStem(pid, 'drums', 0);
    insertStem(pid, 'bass', 1);

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/practices/${pid}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/drive_file_id/);
    const body = JSON.parse(text) as {
      practice: { id: string; name: string };
      stems: { name: string; position: number }[];
    };
    expect(body.practice.id).toBe(pid);
    expect(body.stems.map((s) => s.name)).toEqual(['drums', 'bass']);
  });
});

describe('PATCH /api/practices/:id', () => {
  function tokenResponse(): Response {
    return new Response(
      JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('renames practice and PATCHes Drive folder with the new name', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertPractice(bandId, owner, 'old name', '2026-05-01');
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
      new Request(`http://localhost/api/practices/${pid}`, {
        method: 'PATCH',
        headers: {
          Cookie: cookieHeader(sid),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'new name' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; name: string };
    expect(body).toMatchObject({ ok: true, name: 'new name' });

    const driveCalls = captured.filter((c) => c.method === 'PATCH');
    expect(driveCalls.length).toBe(1);
    expect(driveCalls[0]!.url).toContain('/files/practice-folder');
    expect(driveCalls[0]!.body).toEqual({ name: 'new name' });

    const row = dbMod.db
      .prepare('SELECT name FROM practices WHERE id = ?')
      .get(pid) as { name: string };
    expect(row.name).toBe('new name');
  });

  it('returns 200 even if Drive PATCH responds 500 (DB still updates)', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertPractice(bandId, owner, 'old name', '2026-05-01');
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
      new Request(`http://localhost/api/practices/${pid}`, {
        method: 'PATCH',
        headers: {
          Cookie: cookieHeader(sid),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'renamed' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalled();

    const row = dbMod.db
      .prepare('SELECT name FROM practices WHERE id = ?')
      .get(pid) as { name: string };
    expect(row.name).toBe('renamed');
  });

  it('rejects empty or oversized names with 400', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertPractice(bandId, owner, 'original', '2026-05-01');
    const sid = createSession(owner);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const emptyRes = await app.fetch(
      new Request(`http://localhost/api/practices/${pid}`, {
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
      new Request(`http://localhost/api/practices/${pid}`, {
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
    const row = dbMod.db
      .prepare('SELECT name FROM practices WHERE id = ?')
      .get(pid) as { name: string };
    expect(row.name).toBe('original');
  });

  it('rejects non-members with 404', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertPractice(bandId, owner, 'original', '2026-05-01');
    const sid = createSession(stranger);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await app.fetch(
      new Request(`http://localhost/api/practices/${pid}`, {
        method: 'PATCH',
        headers: {
          Cookie: cookieHeader(sid),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'new name' }),
      }),
    );
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();

    const row = dbMod.db
      .prepare('SELECT name FROM practices WHERE id = ?')
      .get(pid) as { name: string };
    expect(row.name).toBe('original');
  });
});

describe('DELETE /api/practices/:id', () => {
  function tokenResponse(): Response {
    return new Response(
      JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('soft-deletes the practice and trashes the Drive folder', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertPractice(bandId, owner, 'p1', '2026-05-01');
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
      new Request(`http://localhost/api/practices/${pid}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);

    const driveCalls = captured.filter((c) => c.method === 'PATCH');
    expect(driveCalls.length).toBe(1);
    expect(driveCalls[0]!.body).toEqual({ trashed: true });

    expect(dbMod.stmts.findPracticeById.get(pid)).toBeUndefined();
    const row = dbMod.stmts.findPracticeAnyState.get(pid)!;
    expect(row.deleted_at).toBeGreaterThan(0);
    expect(row.deleted_by).toBe(owner);
    expect(row.deleted_reason).toBe('user');
  });

  it('rejects non-members with 404', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertPractice(bandId, owner, 'p1', '2026-05-01');
    const sid = createSession(stranger);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await app.fetch(
      new Request(`http://localhost/api/practices/${pid}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();

    const row = dbMod.stmts.findPracticeAnyState.get(pid)!;
    expect(row.deleted_at).toBeNull();
  });
});

describe('POST /api/practices/:id/restore', () => {
  function tokenResponse(): Response {
    return new Response(
      JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('restores soft-deleted practice and untrashes Drive folder', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertPractice(bandId, owner, 'p1', '2026-05-01');
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.softDeletePractice.run(now, owner, pid);
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
      new Request(`http://localhost/api/practices/${pid}/restore`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);

    const driveCalls = captured.filter((c) => c.method === 'PATCH');
    expect(driveCalls.length).toBe(1);
    expect(driveCalls[0]!.body).toEqual({ trashed: false });

    const row = dbMod.stmts.findPracticeById.get(pid)!;
    expect(row).toBeDefined();
    expect(row.deleted_at).toBeNull();
  });

  it('returns 409 for ghost rows (drive_missing)', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertPractice(bandId, owner, 'p1', '2026-05-01');
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.markPracticeGhost.run(now, pid);
    const sid = createSession(owner);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await app.fetch(
      new Request(`http://localhost/api/practices/${pid}/restore`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();

    const row = dbMod.stmts.findPracticeAnyState.get(pid)!;
    expect(row.deleted_reason).toBe('drive_missing');
  });

  it('rejects non-members with 404', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertPractice(bandId, owner, 'p1', '2026-05-01');
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.softDeletePractice.run(now, owner, pid);
    const sid = createSession(stranger);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await app.fetch(
      new Request(`http://localhost/api/practices/${pid}/restore`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
