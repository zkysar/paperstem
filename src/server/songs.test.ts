import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-songs-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
const audioRoot = join(tmpDir, 'audio');
mkdirSync(audioRoot, { recursive: true });
process.env.DATABASE_PATH = dbPath;
process.env.PAPERSTEM_AUDIO_ROOT = audioRoot;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('./db.js');
type SongsModule = typeof import('./songs.js');
type SectionsModule = typeof import('./sections.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let songsMod: SongsModule;
let sectionsMod: SectionsModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  songsMod = await import('./songs.js');
  sectionsMod = await import('./sections.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.get('/api/bands/:id/songs', songsMod.handleListSongs);
  app.post('/api/bands/:id/songs', songsMod.handleCreateSong);
  app.patch('/api/songs/:id', songsMod.handlePatchSong);
  app.post('/api/songs/:id/merge', songsMod.handleMergeSong);
  app.delete('/api/songs/:id', songsMod.handleDeleteSong);
  app.post('/api/projects/:id/sections', sectionsMod.handleCreateSection);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function encodeId(rel: string): string {
  return Buffer.from(rel, 'utf8').toString('base64url');
}

function reset() {
  dbMod.db.exec(
    'DELETE FROM sections; DELETE FROM songs; DELETE FROM annotations; DELETE FROM stems; DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
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

beforeEach(() => {
  reset();
});

describe('songs CRUD', () => {
  it('creates a song and returns it with use_count=0', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);

    const res = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/songs`, {
        method: 'POST',
        headers: {
          Cookie: cookieHeader(sid),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Heart Sounds' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { song: { id: string; name: string; use_count: number } };
    expect(body.song).toMatchObject({ name: 'Heart Sounds', use_count: 0 });
  });

  it('dedups by normalized name on create', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);

    const first = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/songs`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Heart Sounds' }),
      }),
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { song: { id: string; name: string } };

    // Different casing + whitespace, same normalized key — should return
    // the existing row, not a duplicate. Casing is preserved as originally
    // entered.
    const second = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/songs`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '  heart sounds  ' }),
      }),
    );
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { song: { id: string; name: string } };
    expect(secondBody.song.id).toBe(firstBody.song.id);
    expect(secondBody.song.name).toBe('Heart Sounds');
  });

  it('rejects empty/oversize names', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);

    for (const name of ['', '   ', 'x'.repeat(201)]) {
      const res = await app.fetch(
        new Request(`http://localhost/api/bands/${bandId}/songs`, {
          method: 'POST',
          headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
      );
      expect(res.status).toBe(400);
    }
  });

  it('lists songs ordered by use_count desc', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const projectA = insertProject(bandId, userId, 'pA');
    const projectB = insertProject(bandId, userId, 'pB');

    // Create two songs, one referenced by two projects, one by zero.
    const heartRes = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/songs`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Heart Sounds' }),
      }),
    );
    const heartId = ((await heartRes.json()) as { song: { id: string } }).song.id;

    await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/songs`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Solo Idea' }),
      }),
    );

    for (const pid of [projectA, projectB]) {
      await app.fetch(
        new Request(`http://localhost/api/projects/${pid}/sections`, {
          method: 'POST',
          headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
          body: JSON.stringify({ start_ms: 1000, song_id: heartId }),
        }),
      );
    }

    const list = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/songs`, {
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(list.status).toBe(200);
    const data = (await list.json()) as {
      songs: { name: string; use_count: number }[];
    };
    expect(data.songs).toHaveLength(2);
    expect(data.songs[0]).toMatchObject({ name: 'Heart Sounds', use_count: 2 });
    expect(data.songs[1]).toMatchObject({ name: 'Solo Idea', use_count: 0 });
  });

  it('renames a song', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);

    const create = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/songs`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Heart Sounds' }),
      }),
    );
    const id = ((await create.json()) as { song: { id: string } }).song.id;

    const patch = await app.fetch(
      new Request(`http://localhost/api/songs/${id}`, {
        method: 'PATCH',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Heart Sounds (final)' }),
      }),
    );
    expect(patch.status).toBe(200);
    const body = (await patch.json()) as { song: { name: string } };
    expect(body.song.name).toBe('Heart Sounds (final)');
  });

  it('returns 409 with existing_song_id on rename collision', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);

    async function create(name: string): Promise<string> {
      const r = await app.fetch(
        new Request(`http://localhost/api/bands/${bandId}/songs`, {
          method: 'POST',
          headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
      );
      return ((await r.json()) as { song: { id: string } }).song.id;
    }
    const a = await create('Heart Sounds');
    const b = await create('Other Song');

    const patch = await app.fetch(
      new Request(`http://localhost/api/songs/${b}`, {
        method: 'PATCH',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'heart sounds' }),
      }),
    );
    expect(patch.status).toBe(409);
    const body = (await patch.json()) as {
      error: string;
      existing_song_id: string;
      existing_song_name: string;
    };
    expect(body.error).toBe('name_conflict');
    expect(body.existing_song_id).toBe(a);
    expect(body.existing_song_name).toBe('Heart Sounds');
  });

  it('merges two songs and repoints sections', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const project = insertProject(bandId, userId, 'p1');

    async function create(name: string): Promise<string> {
      const r = await app.fetch(
        new Request(`http://localhost/api/bands/${bandId}/songs`, {
          method: 'POST',
          headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
      );
      return ((await r.json()) as { song: { id: string } }).song.id;
    }
    const winner = await create('Heart Sounds');
    const loser = await create('Heart sounds (typo)');

    // Section pointing at the loser
    await app.fetch(
      new Request(`http://localhost/api/projects/${project}/sections`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_ms: 0, song_id: loser }),
      }),
    );

    const merge = await app.fetch(
      new Request(`http://localhost/api/songs/${loser}/merge`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ into: winner }),
      }),
    );
    expect(merge.status).toBe(200);
    const body = (await merge.json()) as { song: { id: string; use_count: number } };
    expect(body.song.id).toBe(winner);
    expect(body.song.use_count).toBe(1);

    // Loser is gone, section now references the winner.
    const loserRow = dbMod.stmts.findSongById.get(loser);
    expect(loserRow).toBeUndefined();
    const sectionRow = dbMod.db
      .prepare<[string], { song_id: string | null }>(
        'SELECT song_id FROM sections WHERE project_id = ?',
      )
      .get(project);
    expect(sectionRow?.song_id).toBe(winner);
  });

  it('rejects cross-band merge', async () => {
    const userId = createUser('owner@example.com');
    const bandA = createBand('Alpha', userId);
    const bandB = createBand('Beta', userId);
    const sid = createSession(userId);

    async function create(bandId: string, name: string): Promise<string> {
      const r = await app.fetch(
        new Request(`http://localhost/api/bands/${bandId}/songs`, {
          method: 'POST',
          headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
      );
      return ((await r.json()) as { song: { id: string } }).song.id;
    }
    const a = await create(bandA, 'Heart Sounds');
    const b = await create(bandB, 'Other Song');

    const merge = await app.fetch(
      new Request(`http://localhost/api/songs/${b}/merge`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ into: a }),
      }),
    );
    expect(merge.status).toBe(400);
  });

  it('deletes a song and orphans its sections', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const project = insertProject(bandId, userId, 'p1');

    const create = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/songs`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Heart Sounds' }),
      }),
    );
    const songId = ((await create.json()) as { song: { id: string } }).song.id;

    await app.fetch(
      new Request(`http://localhost/api/projects/${project}/sections`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_ms: 0, song_id: songId }),
      }),
    );

    const del = await app.fetch(
      new Request(`http://localhost/api/songs/${songId}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(del.status).toBe(204);

    // Section row survives with song_id NULL.
    const sectionRow = dbMod.db
      .prepare<[string], { song_id: string | null }>(
        'SELECT song_id FROM sections WHERE project_id = ?',
      )
      .get(project);
    expect(sectionRow?.song_id).toBeNull();
  });

  it('refuses access from non-members', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const outsider = createUser('outsider@example.com');
    const sid = createSession(outsider);

    const res = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/songs`, {
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });
});
