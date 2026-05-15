import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-classify-routes-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
const audioRoot = join(tmpDir, 'audio');
mkdirSync(audioRoot, { recursive: true });
process.env.DATABASE_PATH = dbPath;
process.env.PAPERSTEM_AUDIO_ROOT = audioRoot;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('../db.js');
type RoutesModule = typeof import('./routes.js');
type MiddlewareModule = typeof import('../auth/middleware.js');
type CookieModule = typeof import('../auth/cookie.js');
type ChromaModule = typeof import('./chroma-blob.js');
type RepositoryModule = typeof import('./repository.js');

let dbMod: DbModule;
let routesMod: RoutesModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let chromaMod: ChromaModule;
let repoMod: RepositoryModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('../db.js');
  routesMod = await import('./routes.js');
  middlewareMod = await import('../auth/middleware.js');
  cookieMod = await import('../auth/cookie.js');
  chromaMod = await import('./chroma-blob.js');
  repoMod = await import('./repository.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.post('/api/projects/:id/classify', routesMod.handleClassifyProject);
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

function makeChroma(vec: number[], frames = 20): number[][] {
  return Array(frames).fill(vec);
}

const ONE_C_VEC = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const ONE_CSHARP_VEC = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const baseRequest = (overrides: Record<string, unknown> = {}) => ({
  audio_hash: 'audio-hash-1',
  classifier_version: 'yamnet-v1',
  fingerprint_version: 1,
  source_surface: 'web' as const,
  segments: [],
  ...overrides,
});

beforeEach(() => {
  reset();
});

describe('POST /api/projects/:id/classify', () => {
  it('creates auto sections for emitted segment types and skips silence', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const projectId = insertProject(bandId, userId, 'p1');

    const body = baseRequest({
      segments: [
        {
          start_ms: 0,
          end_ms: 4000,
          segment_type: 'music',
          top_classes: [{ name: 'Music', score: 0.9 }],
          chroma: makeChroma(ONE_C_VEC),
        },
        {
          start_ms: 4000,
          end_ms: 6000,
          segment_type: 'chatter',
          top_classes: [{ name: 'Speech', score: 0.8 }],
        },
        {
          start_ms: 6000,
          end_ms: 12000,
          segment_type: 'silence',
          top_classes: [{ name: 'Silence', score: 0.99 }],
        },
      ],
    });

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${projectId}/classify`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as {
      run_id: string;
      reused: boolean;
      sections: {
        id: string;
        segment_type: string;
        label: string | null;
        song_id: string | null;
        confidence: number;
      }[];
    };

    expect(parsed.reused).toBe(false);
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections.map((s) => s.segment_type).sort()).toEqual(['chatter', 'music']);
    const music = parsed.sections.find((s) => s.segment_type === 'music')!;
    expect(music.label).toBe('Music');
    expect(music.song_id).toBeNull();
    const chatter = parsed.sections.find((s) => s.segment_type === 'chatter')!;
    expect(chatter.label).toBe('Chatter');

    // Persisted with source='auto' and run_id set.
    const persisted = dbMod.db
      .prepare(
        'SELECT id, source, run_id, segment_type, top_classes_json FROM sections WHERE project_id = ? ORDER BY start_ms',
      )
      .all(projectId) as {
      id: string;
      source: string;
      run_id: string;
      segment_type: string;
      top_classes_json: string;
    }[];
    expect(persisted).toHaveLength(2);
    for (const row of persisted) {
      expect(row.source).toBe('auto');
      expect(row.run_id).toBe(parsed.run_id);
      expect(JSON.parse(row.top_classes_json)).toBeInstanceOf(Array);
    }

    const run = dbMod.db
      .prepare('SELECT status, completed_at FROM classification_runs WHERE id = ?')
      .get(parsed.run_id) as { status: string; completed_at: number };
    expect(run.status).toBe('done');
    expect(run.completed_at).toBeGreaterThan(0);
  });

  it('skips auto sections that overlap an existing manual section', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const projectId = insertProject(bandId, userId, 'p1');

    // Manual section at 10000 ms.
    const nowSec = Math.floor(Date.now() / 1000);
    dbMod.stmts.insertSection.run(
      randomUUID(),
      projectId,
      10000,
      null,
      'rehearsal',
      'manual',
      nowSec,
      userId,
      nowSec,
    );

    const body = baseRequest({
      segments: [
        {
          // Auto segment 0-15000 ms — manual at 10000 falls inside the range.
          start_ms: 0,
          end_ms: 15000,
          segment_type: 'music',
          top_classes: [{ name: 'Music', score: 0.9 }],
          chroma: makeChroma(ONE_C_VEC),
        },
      ],
    });

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${projectId}/classify`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as { sections: unknown[]; run_id: string };
    expect(parsed.sections).toHaveLength(0);

    const autoRows = dbMod.db
      .prepare("SELECT id FROM sections WHERE project_id = ? AND source = 'auto'")
      .all(projectId);
    expect(autoRows).toHaveLength(0);

    const run = dbMod.db
      .prepare('SELECT status FROM classification_runs WHERE id = ?')
      .get(parsed.run_id) as { status: string };
    expect(run.status).toBe('done');
  });

  it('also drops auto segments whose start_ms falls within 2s of a manual boundary', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const projectId = insertProject(bandId, userId, 'p1');

    const nowSec = Math.floor(Date.now() / 1000);
    dbMod.stmts.insertSection.run(
      randomUUID(),
      projectId,
      20000,
      null,
      'manual-mark',
      'manual',
      nowSec,
      userId,
      nowSec,
    );

    const body = baseRequest({
      segments: [
        // Auto segment from 21500 to 25000: starts 1.5s after manual at 20000 → dropped.
        {
          start_ms: 21500,
          end_ms: 25000,
          segment_type: 'music',
          top_classes: [{ name: 'Music', score: 0.9 }],
          chroma: makeChroma(ONE_C_VEC),
        },
        // Auto segment 30000-34000: well clear of manual at 20000 → kept.
        {
          start_ms: 30000,
          end_ms: 34000,
          segment_type: 'music',
          top_classes: [{ name: 'Music', score: 0.9 }],
          chroma: makeChroma(ONE_C_VEC),
        },
      ],
    });

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${projectId}/classify`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as { sections: { start_ms: number }[] };
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].start_ms).toBe(30000);
  });

  it('matches music segments to a band fingerprint corpus', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const projectId = insertProject(bandId, userId, 'p1');

    // Stored fingerprint for Wagon Wheel — pure C-major.
    const wagonWheelId = insertSong(bandId, 'Wagon Wheel', userId);
    // Need a section row so the fingerprint FK is satisfied.
    const sectionId = randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);
    dbMod.stmts.insertSection.run(
      sectionId,
      projectId,
      1_000_000, // far away from probe segments below to avoid the overlap rule
      wagonWheelId,
      null,
      'manual',
      nowSec,
      userId,
      nowSec,
    );
    const probeChroma = makeChroma(ONE_C_VEC);
    repoMod.insertFingerprint(dbMod.db, {
      id: randomUUID(),
      band_id: bandId,
      song_id: wagonWheelId,
      section_id: sectionId,
      fingerprint_blob: Buffer.from(chromaMod.packChroma(probeChroma)),
      fingerprint_version: 1,
      duration_ms: probeChroma.length * 93,
      created_at: nowSec,
    });

    const body = baseRequest({
      segments: [
        {
          start_ms: 0,
          end_ms: 5000,
          segment_type: 'music',
          top_classes: [{ name: 'Music', score: 0.9 }],
          chroma: makeChroma(ONE_C_VEC),
        },
      ],
    });

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${projectId}/classify`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as {
      sections: {
        song_id: string | null;
        song_name: string | null;
        confidence: number;
        tentative: boolean;
      }[];
    };
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].song_id).toBe(wagonWheelId);
    expect(parsed.sections[0].song_name).toBe('Wagon Wheel');
    expect(parsed.sections[0].confidence).toBeGreaterThan(0.5);
    expect(parsed.sections[0].tentative).toBe(false);
  });

  it('picks the closer fingerprint when multiple songs exist', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const projectId = insertProject(bandId, userId, 'p1');
    const nowSec = Math.floor(Date.now() / 1000);

    const songA = insertSong(bandId, 'Song A', userId);
    const songB = insertSong(bandId, 'Song B', userId);

    for (const [songId, vec] of [
      [songA, ONE_C_VEC],
      [songB, ONE_CSHARP_VEC],
    ] as const) {
      const secId = randomUUID();
      dbMod.stmts.insertSection.run(
        secId,
        projectId,
        1_000_000,
        songId,
        null,
        'manual',
        nowSec,
        userId,
        nowSec,
      );
      const chroma = makeChroma(vec);
      repoMod.insertFingerprint(dbMod.db, {
        id: randomUUID(),
        band_id: bandId,
        song_id: songId,
        section_id: secId,
        fingerprint_blob: Buffer.from(chromaMod.packChroma(chroma)),
        fingerprint_version: 1,
        duration_ms: chroma.length * 93,
        created_at: nowSec,
      });
    }

    const body = baseRequest({
      segments: [
        {
          start_ms: 0,
          end_ms: 5000,
          segment_type: 'music',
          top_classes: [{ name: 'Music', score: 0.9 }],
          chroma: makeChroma(ONE_CSHARP_VEC),
        },
      ],
    });

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${projectId}/classify`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as { sections: { song_id: string | null }[] };
    expect(parsed.sections[0].song_id).toBe(songB);
  });

  it('is idempotent on (project_id, audio_hash, classifier_version, fingerprint_version)', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const projectId = insertProject(bandId, userId, 'p1');

    const body = baseRequest({
      segments: [
        {
          start_ms: 0,
          end_ms: 4000,
          segment_type: 'music',
          top_classes: [{ name: 'Music', score: 0.9 }],
          chroma: makeChroma(ONE_C_VEC),
        },
      ],
    });

    const send = () =>
      app.fetch(
        new Request(`http://localhost/api/projects/${projectId}/classify`, {
          method: 'POST',
          headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );

    const first = await send();
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      run_id: string;
      reused: boolean;
      sections: { id: string }[];
    };
    expect(firstBody.reused).toBe(false);

    const second = await send();
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      run_id: string;
      reused: boolean;
      sections: { id: string }[];
    };
    expect(secondBody.reused).toBe(true);
    expect(secondBody.run_id).toBe(firstBody.run_id);
    expect(secondBody.sections.map((s) => s.id).sort()).toEqual(
      firstBody.sections.map((s) => s.id).sort(),
    );

    // Only one run row + the original sections — no duplicates.
    const runs = dbMod.db
      .prepare('SELECT id FROM classification_runs WHERE project_id = ?')
      .all(projectId);
    expect(runs).toHaveLength(1);

    const autoRows = dbMod.db
      .prepare("SELECT id FROM sections WHERE project_id = ? AND source = 'auto'")
      .all(projectId);
    expect(autoRows).toHaveLength(firstBody.sections.length);
  });

  it('refuses access from non-members', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const projectId = insertProject(bandId, owner, 'p1');
    const outsider = createUser('outsider@example.com');
    const sid = createSession(outsider);

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${projectId}/classify`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
        body: JSON.stringify(baseRequest()),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 without a session cookie', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const projectId = insertProject(bandId, owner, 'p1');

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${projectId}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseRequest()),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects invalid input bodies', async () => {
    const userId = createUser('owner@example.com');
    const bandId = createBand('Alpha', userId);
    const sid = createSession(userId);
    const projectId = insertProject(bandId, userId, 'p1');

    for (const body of [
      { audio_hash: 'h', classifier_version: 'v', fingerprint_version: 1, source_surface: 'web' }, // no segments
      { audio_hash: '', classifier_version: 'v', fingerprint_version: 1, source_surface: 'web', segments: [] },
      { audio_hash: 'h', classifier_version: 'v', fingerprint_version: 1, source_surface: 'bogus', segments: [] },
    ]) {
      const res = await app.fetch(
        new Request(`http://localhost/api/projects/${projectId}/classify`, {
          method: 'POST',
          headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
      expect(res.status).toBe(400);
    }
  });
});
