import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-projects-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csec';
process.env.GOOGLE_REFRESH_TOKEN = 'rtok';

type DbModule = typeof import('./db.js');
type ProjectsModule = typeof import('./projects.js');
type DriveModule = typeof import('./drive.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let projectsMod: ProjectsModule;
let driveMod: DriveModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  projectsMod = await import('./projects.js');
  driveMod = await import('./drive.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.get('/api/projects', projectsMod.handleListProjects);
  app.get('/api/projects/:id', projectsMod.handleGetProject);
  app.patch('/api/projects/:id', projectsMod.handleRenameProject);
  app.delete('/api/projects/:id', projectsMod.handleDeleteProject);
  app.post('/api/projects/:id/restore', projectsMod.handleRestoreProject);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  dbMod.db.exec(
    'DELETE FROM stems; DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
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

function insertProject(
  bandId: string,
  ownerId: string,
  name: string,
  recordedOn: string | null,
): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertProject.run(
    id,
    bandId,
    name,
    recordedOn,
    'project-folder',
    null,
    now,
    ownerId,
    now,
  );
  return id;
}

function insertStem(projectId: string, name: string, position: number): string {
  const id = randomUUID();
  dbMod.stmts.insertStem.run(id, projectId, name, position, `drive-${id}`, null, 1024, null);
  return id;
}

beforeEach(() => {
  reset();
});

describe('GET /api/projects', () => {
  it('returns 401 unauthenticated', async () => {
    const res = await app.fetch(new Request('http://x/api/projects?band_id=any'));
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    insertProject(bandId, owner, 'p1', '2026-05-01');

    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/projects?band_id=${bandId}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns projects sorted by recorded_on desc', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    insertProject(bandId, owner, 'older', '2026-04-01');
    insertProject(bandId, owner, 'newer', '2026-05-01');

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/projects?band_id=${bandId}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: { name: string }[] };
    expect(body.projects.map((p) => p.name)).toEqual(['newer', 'older']);
  });

  it('returns folder_id on each row', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    insertProject(bandId, owner, 'p1', '2026-05-01');

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/projects?band_id=${bandId}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      projects: { name: string; folder_id: string | null }[];
    };
    expect(body.projects[0]).toMatchObject({
      name: 'p1',
      folder_id: 'project-folder',
    });
  });
});

describe('GET /api/projects/:id', () => {
  it('returns 404 for non-members (no leak)', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertProject(bandId, owner, 'p1', '2026-05-01');

    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/projects/${pid}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns project with stems but never file_id', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertProject(bandId, owner, 'p1', '2026-05-01');
    insertStem(pid, 'drums', 0);
    insertStem(pid, 'bass', 1);

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/projects/${pid}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/file_id/);
    const body = JSON.parse(text) as {
      project: { id: string; name: string };
      stems: { name: string; position: number }[];
    };
    expect(body.project.id).toBe(pid);
    expect(body.stems.map((s) => s.name)).toEqual(['drums', 'bass']);
  });
});

describe('PATCH /api/projects/:id', () => {
  function tokenResponse(): Response {
    return new Response(
      JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('renames project and PATCHes Drive folder with the new name', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertProject(bandId, owner, 'old name', '2026-05-01');
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
      new Request(`http://localhost/api/projects/${pid}`, {
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
    expect(driveCalls[0]!.url).toContain('/files/project-folder');
    expect(driveCalls[0]!.body).toEqual({ name: 'new name' });

    const row = dbMod.db
      .prepare('SELECT name FROM projects WHERE id = ?')
      .get(pid) as { name: string };
    expect(row.name).toBe('new name');
  });

  it('returns 200 even if Drive PATCH responds 500 (DB still updates)', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertProject(bandId, owner, 'old name', '2026-05-01');
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
      new Request(`http://localhost/api/projects/${pid}`, {
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
      .prepare('SELECT name FROM projects WHERE id = ?')
      .get(pid) as { name: string };
    expect(row.name).toBe('renamed');
  });

  it('rejects empty or oversized names with 400', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertProject(bandId, owner, 'original', '2026-05-01');
    const sid = createSession(owner);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const emptyRes = await app.fetch(
      new Request(`http://localhost/api/projects/${pid}`, {
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
      new Request(`http://localhost/api/projects/${pid}`, {
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
      .prepare('SELECT name FROM projects WHERE id = ?')
      .get(pid) as { name: string };
    expect(row.name).toBe('original');
  });

  it('rejects non-members with 404', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertProject(bandId, owner, 'original', '2026-05-01');
    const sid = createSession(stranger);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${pid}`, {
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
      .prepare('SELECT name FROM projects WHERE id = ?')
      .get(pid) as { name: string };
    expect(row.name).toBe('original');
  });
});

describe('DELETE /api/projects/:id', () => {
  function tokenResponse(): Response {
    return new Response(
      JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('soft-deletes the project and trashes the Drive folder', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertProject(bandId, owner, 'p1', '2026-05-01');
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
      new Request(`http://localhost/api/projects/${pid}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);

    const driveCalls = captured.filter((c) => c.method === 'PATCH');
    expect(driveCalls.length).toBe(1);
    expect(driveCalls[0]!.body).toEqual({ trashed: true });

    expect(dbMod.stmts.findProjectById.get(pid)).toBeUndefined();
    const row = dbMod.stmts.findProjectAnyState.get(pid)!;
    expect(row.deleted_at).toBeGreaterThan(0);
    expect(row.deleted_by).toBe(owner);
    expect(row.deleted_reason).toBe('user');
  });

  it('rejects non-members with 404', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertProject(bandId, owner, 'p1', '2026-05-01');
    const sid = createSession(stranger);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${pid}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();

    const row = dbMod.stmts.findProjectAnyState.get(pid)!;
    expect(row.deleted_at).toBeNull();
  });
});

describe('POST /api/projects/:id/restore', () => {
  function tokenResponse(): Response {
    return new Response(
      JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('restores soft-deleted project and untrashes Drive folder', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertProject(bandId, owner, 'p1', '2026-05-01');
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.softDeleteProject.run(now, owner, pid);
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
      new Request(`http://localhost/api/projects/${pid}/restore`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);

    const driveCalls = captured.filter((c) => c.method === 'PATCH');
    expect(driveCalls.length).toBe(1);
    expect(driveCalls[0]!.body).toEqual({ trashed: false });

    const row = dbMod.stmts.findProjectById.get(pid)!;
    expect(row).toBeDefined();
    expect(row.deleted_at).toBeNull();
  });

  it('returns 409 for ghost rows (drive_missing)', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertProject(bandId, owner, 'p1', '2026-05-01');
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.markProjectGhost.run(now, pid);
    const sid = createSession(owner);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${pid}/restore`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();

    const row = dbMod.stmts.findProjectAnyState.get(pid)!;
    expect(row.deleted_reason).toBe('drive_missing');
  });

  it('rejects non-members with 404', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertProject(bandId, owner, 'p1', '2026-05-01');
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.softDeleteProject.run(now, owner, pid);
    const sid = createSession(stranger);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${pid}/restore`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
