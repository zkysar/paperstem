import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-audio-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
const audioRoot = join(tmpDir, 'audio');
mkdirSync(audioRoot, { recursive: true });
process.env.DATABASE_PATH = dbPath;
process.env.PAPERSTEM_AUDIO_ROOT = audioRoot;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('./db.js');
type AudioModule = typeof import('./audio.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let audioMod: AudioModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  audioMod = await import('./audio.js');
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

function encodeId(rel: string): string {
  return Buffer.from(rel, 'utf8').toString('base64url');
}

function reset() {
  dbMod.db.exec(
    'DELETE FROM stems; DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
  rmSync(audioRoot, { recursive: true, force: true });
  mkdirSync(audioRoot, { recursive: true });
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
  dbMod.stmts.insertBand.run(id, name, encodeId(name), ownerId, now);
  dbMod.stmts.insertMembership.run(id, ownerId, 'owner', now);
  return id;
}

function createProjectAndStem(
  bandFolderName: string,
  bandId: string,
  ownerId: string,
  options: { contents?: Buffer; createFile?: boolean } = {},
): { projectId: string; stemId: string; fileId: string; rel: string } {
  const { contents = Buffer.from('AUDIODATA'), createFile = true } = options;
  const stemRel = `${bandFolderName}/p1/drums.mp3`;
  if (createFile) {
    mkdirSync(join(audioRoot, bandFolderName, 'p1'), { recursive: true });
    writeFileSync(join(audioRoot, stemRel), contents);
  }
  const projectId = randomUUID();
  const stemId = randomUUID();
  const fileId = encodeId(stemRel);
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertProject.run(
    projectId,
    bandId,
    'project-1',
    null,
    encodeId(`${bandFolderName}/p1`),
    null,
    now,
    ownerId,
    now,
  );
  dbMod.stmts.insertStem.run(stemId, projectId, 'drums', 0, fileId, null, contents.length, null);
  return { projectId, stemId, fileId, rel: stemRel };
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
    const { stemId } = createProjectAndStem('Alpha', bandId, owner);

    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/audio/${stemId}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
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

  it('forwards audio bytes and headers for members, supporting Range', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const body = Buffer.from('AUDIODATA');
    const { stemId } = createProjectAndStem('Alpha', bandId, owner, { contents: body });

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/audio/${stemId}`, {
        headers: { cookie: cookieHeader(sid), range: 'bytes=0-8' },
      }),
    );
    expect(res.status).toBe(206);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('content-range')).toBe(`bytes 0-8/${body.length}`);
    expect(res.headers.get('cache-control')).toBe(
      'private, max-age=31536000, immutable',
    );
    const got = await res.text();
    expect(got).toBe('AUDIODATA');
  });

  it('marks the stem as drive_missing when the file is gone', async () => {
    const owner = createUser('alice@example.com');
    const bandId = createBand('B', owner);
    const sid = createSession(owner);
    const { stemId } = createProjectAndStem('B', bandId, owner, { createFile: false });

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

  it('returns 502 when storage errors unexpectedly', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { stemId, rel } = createProjectAndStem('Alpha', bandId, owner);
    // Replace the file with a directory at the same path so stat().isFile() returns false
    // and storage throws a non-NotFound error.
    rmSync(join(audioRoot, rel));
    mkdirSync(join(audioRoot, rel));

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
