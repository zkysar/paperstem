import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-projects-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
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
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  dbMod.db.exec(
    'DELETE FROM stems; DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
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
    null,
    null,
    now,
    ownerId,
    now,
  );
  return id;
}

function insertStem(projectId: string, name: string, position: number): string {
  const id = randomUUID();
  dbMod.stmts.insertStem.run(id, projectId, name, position, `drive-${id}`, null, 1024);
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

  it('returns project with stems but never drive_file_id', async () => {
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
    expect(text).not.toMatch(/drive_file_id/);
    const body = JSON.parse(text) as {
      project: { id: string; name: string };
      stems: { name: string; position: number }[];
    };
    expect(body.project.id).toBe(pid);
    expect(body.stems.map((s) => s.name)).toEqual(['drums', 'bass']);
  });
});
