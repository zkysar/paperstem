import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-audio-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csec';
process.env.GOOGLE_REFRESH_TOKEN = 'rtok';

type DbModule = typeof import('./db.js');
type AudioModule = typeof import('./audio.js');
type DriveModule = typeof import('./drive.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let audioMod: AudioModule;
let driveMod: DriveModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  audioMod = await import('./audio.js');
  driveMod = await import('./drive.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.get('/api/audio/:stem_id', audioMod.handleGetAudio);
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

function createProjectAndStem(bandId: string, ownerId: string): {
  projectId: string;
  stemId: string;
} {
  const projectId = randomUUID();
  const stemId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertProject.run(
    projectId,
    bandId,
    'project-1',
    null,
    'project-folder',
    null,
    now,
    ownerId,
    now,
  );
  dbMod.stmts.insertStem.run(stemId, projectId, 'drums', 0, 'drive-file-abc', null, 1024, null);
  return { projectId, stemId };
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

beforeEach(() => {
  reset();
});

describe('GET /api/audio/:stem_id', () => {
  it('returns 401 unauthenticated', async () => {
    const res = await app.fetch(new Request('http://x/api/audio/whatever'));
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members (does not leak)', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const { stemId } = createProjectAndStem(bandId, owner);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/audio/${stemId}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 404 for missing stem', async () => {
    const u = createUser('u@example.com');
    const sid = createSession(u);
    const res = await app.fetch(
      new Request('http://x/api/audio/no-such-stem', {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('forwards Drive bytes and headers for members', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { stemId } = createProjectAndStem(bandId, owner);

    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (url.includes('/drive/v3/files/drive-file-abc')) {
        const headersInit = init?.headers as Record<string, string> | undefined;
        const ranged = headersInit && 'Range' in headersInit;
        return Promise.resolve(
          new Response('AUDIODATA', {
            status: ranged ? 206 : 200,
            headers: {
              'Content-Type': 'audio/mpeg',
              'Content-Length': '9',
              'Accept-Ranges': 'bytes',
              ...(ranged ? { 'Content-Range': 'bytes 0-8/9' } : {}),
            },
          }),
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/audio/${stemId}`, {
        headers: { cookie: cookieHeader(sid), range: 'bytes=0-8' },
      }),
    );
    expect(res.status).toBe(206);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('content-range')).toBe('bytes 0-8/9');
    expect(res.headers.get('cache-control')).toBe(
      'private, max-age=31536000, immutable',
    );
    const body = await res.text();
    expect(body).toBe('AUDIODATA');
  });

  it('marks the stem as drive_missing when Drive returns 404', async () => {
    const owner = createUser('alice@example.com');
    const bandId = createBand('B', owner);
    const sid = createSession(owner);
    const { stemId } = createProjectAndStem(bandId, owner);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      return new Response('not found', { status: 404 });
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await app.fetch(
      new Request(`http://x/api/audio/${stemId}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(410);
    expect(warnSpy).toHaveBeenCalled();

    const row = dbMod.db
      .prepare('SELECT deleted_at, deleted_reason FROM stems WHERE id = ?')
      .get(stemId) as {
      deleted_at: number | null;
      deleted_reason: string | null;
    };
    expect(row.deleted_at).toBeGreaterThan(0);
    expect(row.deleted_reason).toBe('drive_missing');
  });

  it('returns 502 when Drive errors', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { stemId } = createProjectAndStem(bandId, owner);

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response('boom', { status: 500 }));
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/audio/${stemId}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(502);
    expect(errSpy).toHaveBeenCalled();
  });
});
