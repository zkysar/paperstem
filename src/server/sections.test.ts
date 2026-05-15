import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-sections-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
const audioRoot = join(tmpDir, 'audio');
mkdirSync(audioRoot, { recursive: true });
process.env.DATABASE_PATH = dbPath;
process.env.PAPERSTEM_AUDIO_ROOT = audioRoot;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('./db.js');
type SectionsModule = typeof import('./sections.js');
type SongsModule = typeof import('./songs.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let sectionsMod: SectionsModule;
let songsMod: SongsModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  sectionsMod = await import('./sections.js');
  songsMod = await import('./songs.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.get('/api/projects/:id/sections', sectionsMod.handleListSections);
  app.post('/api/projects/:id/sections', sectionsMod.handleCreateSection);
  app.patch('/api/sections/:id', sectionsMod.handlePatchSection);
  app.delete('/api/sections/:id', sectionsMod.handleDeleteSection);
  app.get('/api/bands/:id/songs/usage', sectionsMod.handleListSongUsage);
  app.post('/api/bands/:id/songs', songsMod.handleCreateSong);
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

describe('sections CRUD', () => {
  it('creates a section with song_name (finds or creates the song)', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const project = insertProject(bandId, userId, 'p1');

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${project}/sections`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_ms: 12000, song_name: 'Heart Sounds' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      section: { start_ms: number; song_id: string | null; song_name: string | null; label: string | null; source: string };
    };
    expect(body.section).toMatchObject({
      start_ms: 12000,
      song_name: 'Heart Sounds',
      label: null,
      source: 'manual',
    });
    expect(body.section.song_id).not.toBeNull();
  });

  it('creates a section with a free-text label', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const project = insertProject(bandId, userId, 'p1');

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${project}/sections`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_ms: 0, label: 'warmup' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      section: { song_id: string | null; label: string | null };
    };
    expect(body.section.song_id).toBeNull();
    expect(body.section.label).toBe('warmup');
  });

  it('creates an unnamed boundary when neither song nor label is supplied', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const project = insertProject(bandId, userId, 'p1');

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${project}/sections`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_ms: 5000 }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { section: { song_id: string | null; label: string | null } };
    expect(body.section.song_id).toBeNull();
    expect(body.section.label).toBeNull();
  });

  it('rejects sections with both song_id and label set', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const project = insertProject(bandId, userId, 'p1');

    const songRes = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/songs`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Heart Sounds' }),
      }),
    );
    const songId = ((await songRes.json()) as { song: { id: string } }).song.id;

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${project}/sections`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_ms: 0, song_id: songId, label: 'extra' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects invalid start_ms', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const project = insertProject(bandId, userId, 'p1');

    for (const start_ms of [-1, 1.5, 'nope', null]) {
      const res = await app.fetch(
        new Request(`http://localhost/api/projects/${project}/sections`, {
          method: 'POST',
          headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
          body: JSON.stringify({ start_ms, song_name: 'Heart Sounds' }),
        }),
      );
      expect(res.status).toBe(400);
    }
  });

  it('lists sections joined with song name, ordered by start_ms', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const project = insertProject(bandId, userId, 'p1');

    for (const [start, name] of [[3000, 'Solo Idea'], [1000, 'Heart Sounds']] as const) {
      await app.fetch(
        new Request(`http://localhost/api/projects/${project}/sections`, {
          method: 'POST',
          headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
          body: JSON.stringify({ start_ms: start, song_name: name }),
        }),
      );
    }

    const list = await app.fetch(
      new Request(`http://localhost/api/projects/${project}/sections`, {
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      sections: { start_ms: number; song_name: string | null }[];
    };
    expect(body.sections.map((s) => [s.start_ms, s.song_name])).toEqual([
      [1000, 'Heart Sounds'],
      [3000, 'Solo Idea'],
    ]);
  });

  it('patches start_ms and updates song via song_name', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const project = insertProject(bandId, userId, 'p1');

    const create = await app.fetch(
      new Request(`http://localhost/api/projects/${project}/sections`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_ms: 1000, song_name: 'Heart Sounds' }),
      }),
    );
    const sectionId = ((await create.json()) as { section: { id: string } }).section.id;

    const patch = await app.fetch(
      new Request(`http://localhost/api/sections/${sectionId}`, {
        method: 'PATCH',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_ms: 5000, song_name: 'New Tune' }),
      }),
    );
    expect(patch.status).toBe(200);
    const body = (await patch.json()) as {
      section: { start_ms: number; song_name: string | null };
    };
    expect(body.section.start_ms).toBe(5000);
    expect(body.section.song_name).toBe('New Tune');
  });

  it('clear_name unsets both song and label', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const project = insertProject(bandId, userId, 'p1');

    const create = await app.fetch(
      new Request(`http://localhost/api/projects/${project}/sections`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_ms: 1000, song_name: 'Heart Sounds' }),
      }),
    );
    const sectionId = ((await create.json()) as { section: { id: string } }).section.id;

    const patch = await app.fetch(
      new Request(`http://localhost/api/sections/${sectionId}`, {
        method: 'PATCH',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear_name: true }),
      }),
    );
    expect(patch.status).toBe(200);
    const body = (await patch.json()) as {
      section: { song_id: string | null; song_name: string | null; label: string | null };
    };
    expect(body.section.song_id).toBeNull();
    expect(body.section.song_name).toBeNull();
    expect(body.section.label).toBeNull();
  });

  it('deletes a section', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const project = insertProject(bandId, userId, 'p1');

    const create = await app.fetch(
      new Request(`http://localhost/api/projects/${project}/sections`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_ms: 1000, song_name: 'Heart Sounds' }),
      }),
    );
    const sectionId = ((await create.json()) as { section: { id: string } }).section.id;

    const del = await app.fetch(
      new Request(`http://localhost/api/sections/${sectionId}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(del.status).toBe(204);

    const list = await app.fetch(
      new Request(`http://localhost/api/projects/${project}/sections`, {
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    const body = (await list.json()) as { sections: unknown[] };
    expect(body.sections).toHaveLength(0);
  });

  it('rejects sections with a song_id from a different band', async () => {
    const userId = createUser('owner@example.com');
    const bandA = createBand('Alpha', userId);
    const bandB = createBand('Beta', userId);
    const sid = createSession(userId);
    const projectInA = insertProject(bandA, userId, 'p1');

    // Create a song in Band B.
    const songRes = await app.fetch(
      new Request(`http://localhost/api/bands/${bandB}/songs`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Heart Sounds' }),
      }),
    );
    const bandBSongId = ((await songRes.json()) as { song: { id: string } }).song.id;

    // Try to attach Band B's song to a Band A project's section.
    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${projectInA}/sections`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_ms: 0, song_id: bandBSongId }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('section create with song_name finds existing band song (no duplicates)', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const project = insertProject(bandId, userId, 'p1');

    // Pre-create the song with one casing/whitespace shape.
    const first = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/songs`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Heart Sounds' }),
      }),
    );
    const songId = ((await first.json()) as { song: { id: string } }).song.id;

    // Section creation with a normalization-equivalent song_name should
    // re-use the existing row, not insert a duplicate.
    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${project}/sections`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_ms: 0, song_name: '  heart sounds  ' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { section: { song_id: string | null } };
    expect(body.section.song_id).toBe(songId);

    // Confirm the catalog still has exactly one song row.
    const songCount = dbMod.db
      .prepare<[string], { c: number }>('SELECT COUNT(*) AS c FROM songs WHERE band_id = ?')
      .get(bandId);
    expect(songCount?.c).toBe(1);
  });

  it('refuses access from non-members', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const project = insertProject(bandId, owner, 'p1');
    const outsider = createUser('outsider@example.com');
    const sid = createSession(outsider);

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${project}/sections`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_ms: 0, song_name: 'Heart Sounds' }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe('song usage', () => {
  it('returns (project_id, song_id) pairs for live projects only', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const liveProject = insertProject(bandId, userId, 'live');
    const trashedProject = insertProject(bandId, userId, 'trashed');
    // Trash the second project so its sections shouldn't appear.
    const now = Math.floor(Date.now() / 1000);
    dbMod.db
      .prepare('UPDATE projects SET deleted_at = ? WHERE id = ?')
      .run(now, trashedProject);

    const songRes = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/songs`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Heart Sounds' }),
      }),
    );
    const songId = ((await songRes.json()) as { song: { id: string } }).song.id;

    for (const pid of [liveProject, trashedProject]) {
      // Insert section row directly (the create endpoint requires the
      // project to be live).
      dbMod.stmts.insertSection.run(
        randomUUID(),
        pid,
        0,
        songId,
        null,
        'manual',
        now,
        userId,
        now,
      );
    }

    const usage = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/songs/usage`, {
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(usage.status).toBe(200);
    const body = (await usage.json()) as {
      usage: { project_id: string; song_id: string }[];
    };
    expect(body.usage).toEqual([{ project_id: liveProject, song_id: songId }]);
  });
});
