import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-projects-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
const audioRoot = join(tmpDir, 'audio');
mkdirSync(audioRoot, { recursive: true });
process.env.DATABASE_PATH = dbPath;
process.env.PAPERSTEM_AUDIO_ROOT = audioRoot;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('./db.js');
type ProjectsModule = typeof import('./projects.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let projectsMod: ProjectsModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  projectsMod = await import('./projects.js');
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

function encodeId(rel: string): string {
  return Buffer.from(rel, 'utf8').toString('base64url');
}

function reset() {
  dbMod.db.exec(
    'DELETE FROM stems; DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
  rmSync(audioRoot, { recursive: true, force: true });
  mkdirSync(audioRoot, { recursive: true });
}

function createUser(email: string): string {
  const id = randomUUID();
  dbMod.stmts.insertUser.run(id, email, null, Math.floor(Date.now() / 1000));
  return id;
}

function createBand(name: string, ownerId: string): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertBand.run(id, name, encodeId(name), ownerId, now);
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
  bandName: string,
  ownerId: string,
  name: string,
  recordedOn: string | null,
): { id: string; folderRel: string; folderId: string } {
  const id = randomUUID();
  const folderRel = `${bandName}/${name}`;
  const folderId = encodeId(folderRel);
  // Create the on-disk folder so trash/rename succeed.
  mkdirSync(join(audioRoot, folderRel), { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertProject.run(
    id,
    bandId,
    name,
    recordedOn,
    folderId,
    null,
    now,
    ownerId,
    now,
  );
  return { id, folderRel, folderId };
}

function insertStem(projectId: string, name: string, position: number): string {
  const id = randomUUID();
  dbMod.stmts.insertStem.run(id, projectId, name, position, encodeId(`stem-${id}`), null, 1024, null);
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
    insertProject(bandId, 'Alpha', owner, 'p1', '2026-05-01');

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
    insertProject(bandId, 'Alpha', owner, 'older', '2026-04-01');
    insertProject(bandId, 'Alpha', owner, 'newer', '2026-05-01');

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
    const { folderId } = insertProject(bandId, 'Alpha', owner, 'p1', '2026-05-01');

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
      folder_id: folderId,
    });
  });
});

describe('GET /api/projects/:id', () => {
  it('returns 404 for non-members (no leak)', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1', '2026-05-01');

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
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1', '2026-05-01');
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
  it('renames project on disk and in DB', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid, folderRel } = insertProject(bandId, 'Alpha', owner, 'old name', '2026-05-01');
    const sid = createSession(owner);

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

    expect(existsSync(join(audioRoot, folderRel))).toBe(false);
    expect(existsSync(join(audioRoot, 'Alpha', 'new name'))).toBe(true);

    const row = dbMod.db
      .prepare('SELECT name FROM projects WHERE id = ?')
      .get(pid) as { name: string };
    expect(row.name).toBe('new name');
  });

  it('returns 200 even if filesystem rename fails (DB still updates)', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid, folderRel } = insertProject(bandId, 'Alpha', owner, 'old name', '2026-05-01');
    rmSync(join(audioRoot, folderRel), { recursive: true });
    const sid = createSession(owner);

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

    const row = dbMod.db
      .prepare('SELECT name FROM projects WHERE id = ?')
      .get(pid) as { name: string };
    expect(row.name).toBe('renamed');
  });

  it('rejects empty or oversized names with 400', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid, folderRel } = insertProject(bandId, 'Alpha', owner, 'original', '2026-05-01');
    const sid = createSession(owner);

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

    expect(existsSync(join(audioRoot, folderRel))).toBe(true);
    const row = dbMod.db
      .prepare('SELECT name FROM projects WHERE id = ?')
      .get(pid) as { name: string };
    expect(row.name).toBe('original');
  });

  it('rejects non-members with 404', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid, folderRel } = insertProject(bandId, 'Alpha', owner, 'original', '2026-05-01');
    const sid = createSession(stranger);

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

    expect(existsSync(join(audioRoot, folderRel))).toBe(true);
    const row = dbMod.db
      .prepare('SELECT name FROM projects WHERE id = ?')
      .get(pid) as { name: string };
    expect(row.name).toBe('original');
  });
});

describe('DELETE /api/projects/:id', () => {
  it('soft-deletes the project and removes the folder from disk', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid, folderRel } = insertProject(bandId, 'Alpha', owner, 'p1', '2026-05-01');
    const sid = createSession(owner);

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${pid}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);

    expect(existsSync(join(audioRoot, folderRel))).toBe(false);

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
    const { id: pid, folderRel } = insertProject(bandId, 'Alpha', owner, 'p1', '2026-05-01');
    const sid = createSession(stranger);

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${pid}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
    expect(existsSync(join(audioRoot, folderRel))).toBe(true);

    const row = dbMod.stmts.findProjectAnyState.get(pid)!;
    expect(row.deleted_at).toBeNull();
  });
});

describe('POST /api/projects/:id/restore', () => {
  it('restores soft-deleted project (untrash is a no-op on local storage)', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1', '2026-05-01');
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.softDeleteProject.run(now, owner, pid);
    const sid = createSession(owner);

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${pid}/restore`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);

    const row = dbMod.stmts.findProjectById.get(pid)!;
    expect(row).toBeDefined();
    expect(row.deleted_at).toBeNull();
  });

  it('returns 409 for ghost rows (drive_missing)', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1', '2026-05-01');
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.markProjectGhost.run(now, pid);
    const sid = createSession(owner);

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${pid}/restore`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(409);

    const row = dbMod.stmts.findProjectAnyState.get(pid)!;
    expect(row.deleted_reason).toBe('drive_missing');
  });

  it('rejects non-members with 404', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1', '2026-05-01');
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.softDeleteProject.run(now, owner, pid);
    const sid = createSession(stranger);

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${pid}/restore`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });
});
