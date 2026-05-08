import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-annotations-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('./db.js');
type AnnotationsModule = typeof import('./annotations.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let annotationsMod: AnnotationsModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  annotationsMod = await import('./annotations.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.get('/api/practices/:id/annotations', annotationsMod.handleListAnnotations);
  app.post('/api/practices/:id/annotations', annotationsMod.handleCreateAnnotation);
  app.patch('/api/annotations/:id', annotationsMod.handlePatchAnnotation);
  app.delete('/api/annotations/:id', annotationsMod.handleDeleteAnnotation);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  dbMod.db.exec(
    'DELETE FROM annotations; DELETE FROM stems; DELETE FROM practices; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
}

function createUser(email: string, displayName: string | null = null): string {
  const id = randomUUID();
  dbMod.stmts.insertUser.run(id, email, displayName, Math.floor(Date.now() / 1000));
  return id;
}

function createBand(ownerId: string): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertBand.run(id, 'Alpha', 'drive-x', ownerId, now);
  dbMod.stmts.insertMembership.run(id, ownerId, 'owner', now);
  return id;
}

function addMember(bandId: string, userId: string) {
  dbMod.stmts.insertMembership.run(
    bandId,
    userId,
    'member',
    Math.floor(Date.now() / 1000),
  );
}

function insertPractice(bandId: string, userId: string): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertPractice.run(
    id,
    bandId,
    'p1',
    null,
    'practice-folder',
    null,
    now,
    userId,
    now,
  );
  return id;
}

function createSession(userId: string): string {
  const sid = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertSession.run(sid, userId, now + 3600, now);
  return sid;
}

function cookie(sid: string): string {
  return `${cookieMod.SESSION_COOKIE_NAME}=${sid}`;
}

function insertAnnotation(
  practiceId: string,
  userId: string,
  startMs: number,
  endMs: number | null = null,
  body = 'note',
  starred = 0,
): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertAnnotation.run(
    id,
    practiceId,
    userId,
    startMs,
    endMs,
    body,
    starred,
    now,
    now,
  );
  return id;
}

beforeEach(() => {
  reset();
});

describe('GET /api/practices/:id/annotations', () => {
  it('returns 401 unauthenticated', async () => {
    const res = await app.fetch(
      new Request('http://x/api/practices/anything/annotations'),
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members (no leak)', async () => {
    const owner = createUser('o@x.com');
    const stranger = createUser('s@x.com');
    const bandId = createBand(owner);
    const pid = insertPractice(bandId, owner);
    insertAnnotation(pid, owner, 0);

    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/practices/${pid}/annotations`, {
        headers: { cookie: cookie(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for missing practice', async () => {
    const u = createUser('u@x.com');
    const sid = createSession(u);
    const res = await app.fetch(
      new Request('http://x/api/practices/nonexistent/annotations', {
        headers: { cookie: cookie(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns annotations sorted by start_ms then created_at with author info', async () => {
    const owner = createUser('o@x.com', 'Owner');
    const member = createUser('m@x.com', null);
    const bandId = createBand(owner);
    addMember(bandId, member);
    const pid = insertPractice(bandId, owner);
    insertAnnotation(pid, owner, 5000, null, 'b');
    insertAnnotation(pid, member, 1000, 2500, 'a');

    const sid = createSession(member);
    const res = await app.fetch(
      new Request(`http://x/api/practices/${pid}/annotations`, {
        headers: { cookie: cookie(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      annotations: {
        body: string;
        start_ms: number;
        end_ms: number | null;
        starred: boolean;
        user_email: string;
        user_display_name: string | null;
      }[];
    };
    expect(body.annotations).toHaveLength(2);
    expect(body.annotations[0].body).toBe('a');
    expect(body.annotations[0].start_ms).toBe(1000);
    expect(body.annotations[0].end_ms).toBe(2500);
    expect(body.annotations[0].user_email).toBe('m@x.com');
    expect(body.annotations[1].body).toBe('b');
    expect(body.annotations[1].user_display_name).toBe('Owner');
    expect(typeof body.annotations[0].starred).toBe('boolean');
  });
});

describe('POST /api/practices/:id/annotations', () => {
  it('rejects unauthenticated', async () => {
    const res = await app.fetch(
      new Request('http://x/api/practices/x/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_ms: 0, body: 'hi' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects non-members with 404', async () => {
    const owner = createUser('o@x.com');
    const stranger = createUser('s@x.com');
    const bandId = createBand(owner);
    const pid = insertPractice(bandId, owner);

    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/practices/${pid}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: cookie(sid) },
        body: JSON.stringify({ start_ms: 0, body: 'x' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('inserts an annotation, stamps user_id, returns joined row', async () => {
    const owner = createUser('o@x.com', 'Owner');
    const bandId = createBand(owner);
    const pid = insertPractice(bandId, owner);
    const sid = createSession(owner);

    const res = await app.fetch(
      new Request(`http://x/api/practices/${pid}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: cookie(sid) },
        body: JSON.stringify({
          start_ms: 1500,
          end_ms: 3000,
          body: 'first note',
          starred: true,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      annotation: {
        id: string;
        user_id: string;
        user_email: string;
        user_display_name: string | null;
        start_ms: number;
        end_ms: number | null;
        body: string;
        starred: boolean;
      };
    };
    expect(body.annotation.user_id).toBe(owner);
    expect(body.annotation.user_email).toBe('o@x.com');
    expect(body.annotation.user_display_name).toBe('Owner');
    expect(body.annotation.start_ms).toBe(1500);
    expect(body.annotation.end_ms).toBe(3000);
    expect(body.annotation.body).toBe('first note');
    expect(body.annotation.starred).toBe(true);
  });

  it('rejects negative start_ms', async () => {
    const owner = createUser('o@x.com');
    const bandId = createBand(owner);
    const pid = insertPractice(bandId, owner);
    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/practices/${pid}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: cookie(sid) },
        body: JSON.stringify({ start_ms: -1, body: 'x' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects end_ms <= start_ms', async () => {
    const owner = createUser('o@x.com');
    const bandId = createBand(owner);
    const pid = insertPractice(bandId, owner);
    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/practices/${pid}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: cookie(sid) },
        body: JSON.stringify({ start_ms: 1000, end_ms: 1000, body: 'x' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects empty body', async () => {
    const owner = createUser('o@x.com');
    const bandId = createBand(owner);
    const pid = insertPractice(bandId, owner);
    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/practices/${pid}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: cookie(sid) },
        body: JSON.stringify({ start_ms: 0, body: '' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects body over 32KB', async () => {
    const owner = createUser('o@x.com');
    const bandId = createBand(owner);
    const pid = insertPractice(bandId, owner);
    const sid = createSession(owner);
    const tooLong = 'a'.repeat(32769);
    const res = await app.fetch(
      new Request(`http://x/api/practices/${pid}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: cookie(sid) },
        body: JSON.stringify({ start_ms: 0, body: tooLong }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/annotations/:id', () => {
  it('returns 404 for non-members', async () => {
    const owner = createUser('o@x.com');
    const stranger = createUser('s@x.com');
    const bandId = createBand(owner);
    const pid = insertPractice(bandId, owner);
    const aid = insertAnnotation(pid, owner, 0);

    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/annotations/${aid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: cookie(sid) },
        body: JSON.stringify({ body: 'edit' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 403 for members who do not own the annotation', async () => {
    const owner = createUser('o@x.com');
    const member = createUser('m@x.com');
    const bandId = createBand(owner);
    addMember(bandId, member);
    const pid = insertPractice(bandId, owner);
    const aid = insertAnnotation(pid, owner, 0);

    const sid = createSession(member);
    const res = await app.fetch(
      new Request(`http://x/api/annotations/${aid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: cookie(sid) },
        body: JSON.stringify({ body: 'edit' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('applies a partial update and bumps updated_at', async () => {
    const owner = createUser('o@x.com');
    const bandId = createBand(owner);
    const pid = insertPractice(bandId, owner);
    const aid = insertAnnotation(pid, owner, 1000, 2000, 'orig', 0);
    const before = dbMod.stmts.findAnnotationById.get(aid)!;

    await new Promise((r) => setTimeout(r, 1100));

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/annotations/${aid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: cookie(sid) },
        body: JSON.stringify({ body: 'updated', starred: true }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      annotation: {
        body: string;
        starred: boolean;
        start_ms: number;
        end_ms: number | null;
        updated_at: number;
      };
    };
    expect(body.annotation.body).toBe('updated');
    expect(body.annotation.starred).toBe(true);
    expect(body.annotation.start_ms).toBe(1000);
    expect(body.annotation.end_ms).toBe(2000);
    expect(body.annotation.updated_at).toBeGreaterThan(before.updated_at);
  });

  it('rejects invalid range on patch', async () => {
    const owner = createUser('o@x.com');
    const bandId = createBand(owner);
    const pid = insertPractice(bandId, owner);
    const aid = insertAnnotation(pid, owner, 1000, 2000);

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/annotations/${aid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: cookie(sid) },
        body: JSON.stringify({ end_ms: 500 }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/annotations/:id', () => {
  it('returns 404 for non-members', async () => {
    const owner = createUser('o@x.com');
    const stranger = createUser('s@x.com');
    const bandId = createBand(owner);
    const pid = insertPractice(bandId, owner);
    const aid = insertAnnotation(pid, owner, 0);

    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/annotations/${aid}`, {
        method: 'DELETE',
        headers: { cookie: cookie(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 403 for members who do not own', async () => {
    const owner = createUser('o@x.com');
    const member = createUser('m@x.com');
    const bandId = createBand(owner);
    addMember(bandId, member);
    const pid = insertPractice(bandId, owner);
    const aid = insertAnnotation(pid, owner, 0);

    const sid = createSession(member);
    const res = await app.fetch(
      new Request(`http://x/api/annotations/${aid}`, {
        method: 'DELETE',
        headers: { cookie: cookie(sid) },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('deletes the annotation and returns 204', async () => {
    const owner = createUser('o@x.com');
    const bandId = createBand(owner);
    const pid = insertPractice(bandId, owner);
    const aid = insertAnnotation(pid, owner, 0);

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/annotations/${aid}`, {
        method: 'DELETE',
        headers: { cookie: cookie(sid) },
      }),
    );
    expect(res.status).toBe(204);
    expect(dbMod.stmts.findAnnotationById.get(aid)).toBeUndefined();
  });
});

describe('validateStartEnd helper', () => {
  it('accepts non-negative start with null end', () => {
    const r = annotationsMod._internal.validateStartEnd(0, null);
    expect(r.ok).toBe(true);
  });

  it('rejects negative start', () => {
    const r = annotationsMod._internal.validateStartEnd(-1, null);
    expect(r.ok).toBe(false);
  });

  it('rejects end equal to start', () => {
    const r = annotationsMod._internal.validateStartEnd(100, 100);
    expect(r.ok).toBe(false);
  });

  it('rejects end less than start', () => {
    const r = annotationsMod._internal.validateStartEnd(100, 50);
    expect(r.ok).toBe(false);
  });

  it('accepts end greater than start', () => {
    const r = annotationsMod._internal.validateStartEnd(100, 200);
    expect(r.ok).toBe(true);
  });

  it('rejects non-integer start', () => {
    const r = annotationsMod._internal.validateStartEnd(1.5, null);
    expect(r.ok).toBe(false);
  });
});
