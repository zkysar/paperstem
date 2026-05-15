import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-fp-route-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
const audioRoot = join(tmpDir, 'audio');
mkdirSync(audioRoot, { recursive: true });
process.env.DATABASE_PATH = dbPath;
process.env.PAPERSTEM_AUDIO_ROOT = audioRoot;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('../db.js');
type RoutesModule = typeof import('./fingerprint-route.js');
type MiddlewareModule = typeof import('../auth/middleware.js');
type CookieModule = typeof import('../auth/cookie.js');

let dbMod: DbModule;
let routesMod: RoutesModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('../db.js');
  routesMod = await import('./fingerprint-route.js');
  middlewareMod = await import('../auth/middleware.js');
  cookieMod = await import('../auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.post(
    '/api/projects/:id/sections/:sectionId/fingerprint',
    routesMod.handleSectionFingerprint,
  );
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function encodeId(rel: string): string {
  return Buffer.from(rel, 'utf8').toString('base64url');
}

function reset() {
  dbMod.db.exec(
    'DELETE FROM song_fingerprints; DELETE FROM classification_runs; DELETE FROM sections; DELETE FROM songs; DELETE FROM annotations; DELETE FROM stems; DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
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

function insertProject(bandId: string, ownerId: string, name: string): string {
  const id = randomUUID();
  const folderId = encodeId(`${bandId}/${name}`);
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertProject.run(id, bandId, name, null, folderId, null, now, ownerId, now);
  return id;
}

function insertSong(bandId: string, name: string, userId: string): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertSong.run(id, bandId, name, name.toLowerCase().trim(), now, userId);
  return id;
}

function insertSection(
  projectId: string,
  userId: string,
  opts: { start_ms: number; song_id: string | null; label?: string | null },
): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertSection.run(
    id,
    projectId,
    opts.start_ms,
    opts.song_id,
    opts.label ?? null,
    'manual',
    now,
    userId,
    now,
  );
  return id;
}

const ONE_C_VEC = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const ONE_CSHARP_VEC = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
function makeChroma(vec: number[], frames = 20): number[][] {
  return Array(frames).fill(vec);
}

beforeEach(() => {
  reset();
});

describe('POST /api/projects/:id/sections/:sectionId/fingerprint', () => {
  it('inserts a fingerprint row for a section with a song_id', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const projectId = insertProject(bandId, userId, 'p1');
    const songId = insertSong(bandId, 'Wagon Wheel', userId);
    const sectionId = insertSection(projectId, userId, {
      start_ms: 0,
      song_id: songId,
    });

    const body = {
      chroma: makeChroma(ONE_C_VEC),
      fingerprint_version: 1,
      duration_ms: 30000,
    };

    const res = await app.fetch(
      new Request(
        `http://localhost/api/projects/${projectId}/sections/${sectionId}/fingerprint`,
        {
          method: 'POST',
          headers: {
            Cookie: cookieHeader(sid),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      ),
    );
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as { id: string };
    expect(parsed.id).toMatch(/^[0-9a-f-]{36}$/);

    const rows = dbMod.db
      .prepare(
        'SELECT id, band_id, song_id, section_id, fingerprint_version, duration_ms FROM song_fingerprints',
      )
      .all() as {
      id: string;
      band_id: string;
      song_id: string;
      section_id: string;
      fingerprint_version: number;
      duration_ms: number;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].band_id).toBe(bandId);
    expect(rows[0].song_id).toBe(songId);
    expect(rows[0].section_id).toBe(sectionId);
    expect(rows[0].fingerprint_version).toBe(1);
    expect(rows[0].duration_ms).toBe(30000);
  });

  it('refuses sections without a song_id', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const projectId = insertProject(bandId, userId, 'p1');
    const sectionId = insertSection(projectId, userId, {
      start_ms: 0,
      song_id: null,
      label: 'warmup',
    });

    const res = await app.fetch(
      new Request(
        `http://localhost/api/projects/${projectId}/sections/${sectionId}/fingerprint`,
        {
          method: 'POST',
          headers: {
            Cookie: cookieHeader(sid),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chroma: makeChroma(ONE_C_VEC),
            fingerprint_version: 1,
            duration_ms: 5000,
          }),
        },
      ),
    );
    expect(res.status).toBe(400);
    const parsed = (await res.json()) as { error: string };
    expect(parsed.error).toBe('section_must_reference_a_song');

    const rows = dbMod.db.prepare('SELECT id FROM song_fingerprints').all();
    expect(rows).toHaveLength(0);
  });

  it('is idempotent: a second POST replaces the existing fingerprint', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const projectId = insertProject(bandId, userId, 'p1');
    const songId = insertSong(bandId, 'Wagon Wheel', userId);
    const sectionId = insertSection(projectId, userId, {
      start_ms: 0,
      song_id: songId,
    });

    const post = (chroma: number[][]) =>
      app.fetch(
        new Request(
          `http://localhost/api/projects/${projectId}/sections/${sectionId}/fingerprint`,
          {
            method: 'POST',
            headers: {
              Cookie: cookieHeader(sid),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              chroma,
              fingerprint_version: 1,
              duration_ms: 5000,
            }),
          },
        ),
      );

    const first = await post(makeChroma(ONE_C_VEC));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { id: string };

    const second = await post(makeChroma(ONE_CSHARP_VEC));
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { id: string };
    expect(secondBody.id).not.toBe(firstBody.id);

    // Only one row remains.
    const rows = dbMod.db
      .prepare('SELECT id FROM song_fingerprints WHERE section_id = ?')
      .all(sectionId) as { id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(secondBody.id);
  });

  it('returns 404 for outsiders (non-band-members)', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const projectId = insertProject(bandId, owner, 'p1');
    const songId = insertSong(bandId, 'Wagon Wheel', owner);
    const sectionId = insertSection(projectId, owner, {
      start_ms: 0,
      song_id: songId,
    });

    const outsider = createUser('outsider@example.com');
    const sid = createSession(outsider);

    const res = await app.fetch(
      new Request(
        `http://localhost/api/projects/${projectId}/sections/${sectionId}/fingerprint`,
        {
          method: 'POST',
          headers: {
            Cookie: cookieHeader(sid),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chroma: makeChroma(ONE_C_VEC),
            fingerprint_version: 1,
            duration_ms: 5000,
          }),
        },
      ),
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 without a session cookie', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const projectId = insertProject(bandId, owner, 'p1');
    const songId = insertSong(bandId, 'Wagon Wheel', owner);
    const sectionId = insertSection(projectId, owner, {
      start_ms: 0,
      song_id: songId,
    });

    const res = await app.fetch(
      new Request(
        `http://localhost/api/projects/${projectId}/sections/${sectionId}/fingerprint`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chroma: makeChroma(ONE_C_VEC),
            fingerprint_version: 1,
            duration_ms: 5000,
          }),
        },
      ),
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when the section does not belong to the project', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const projectA = insertProject(bandId, userId, 'pA');
    const projectB = insertProject(bandId, userId, 'pB');
    const songId = insertSong(bandId, 'Wagon Wheel', userId);
    const sectionInB = insertSection(projectB, userId, {
      start_ms: 0,
      song_id: songId,
    });

    const res = await app.fetch(
      new Request(
        `http://localhost/api/projects/${projectA}/sections/${sectionInB}/fingerprint`,
        {
          method: 'POST',
          headers: {
            Cookie: cookieHeader(sid),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chroma: makeChroma(ONE_C_VEC),
            fingerprint_version: 1,
            duration_ms: 5000,
          }),
        },
      ),
    );
    expect(res.status).toBe(404);
  });

  it('rejects invalid bodies', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const projectId = insertProject(bandId, userId, 'p1');
    const songId = insertSong(bandId, 'Wagon Wheel', userId);
    const sectionId = insertSection(projectId, userId, {
      start_ms: 0,
      song_id: songId,
    });

    const bads = [
      { fingerprint_version: 1, duration_ms: 5000 }, // missing chroma
      { chroma: [], fingerprint_version: 1, duration_ms: 5000 }, // empty chroma
      { chroma: [[1, 2, 3]], fingerprint_version: 1, duration_ms: 5000 }, // wrong row length
      { chroma: makeChroma(ONE_C_VEC), duration_ms: 5000 }, // missing version
      { chroma: makeChroma(ONE_C_VEC), fingerprint_version: 1.5, duration_ms: 5000 }, // non-int version
      { chroma: makeChroma(ONE_C_VEC), fingerprint_version: 1 }, // missing duration
      { chroma: makeChroma(ONE_C_VEC), fingerprint_version: 1, duration_ms: -1 }, // negative duration
    ];

    for (const body of bads) {
      const res = await app.fetch(
        new Request(
          `http://localhost/api/projects/${projectId}/sections/${sectionId}/fingerprint`,
          {
            method: 'POST',
            headers: {
              Cookie: cookieHeader(sid),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          },
        ),
      );
      expect(res.status).toBe(400);
    }
  });
});
