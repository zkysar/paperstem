import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-reactions-test-'));
process.env.DATABASE_PATH = join(tmpDir, 'test.sqlite');
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('./db.js');
type ReactionsModule = typeof import('./annotation-reactions.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let reactionsMod: ReactionsModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  reactionsMod = await import('./annotation-reactions.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.post('/api/annotations/:annotationId/reactions', reactionsMod.handleAddAnnotationReaction);
  app.delete('/api/annotations/:annotationId/reactions', reactionsMod.handleRemoveAnnotationReaction);
  app.post('/api/annotation-replies/:replyId/reactions', reactionsMod.handleAddReplyReaction);
  app.delete('/api/annotation-replies/:replyId/reactions', reactionsMod.handleRemoveReplyReaction);
});

afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

function reset() {
  dbMod.db.exec(
    'DELETE FROM annotation_reply_reactions; DELETE FROM annotation_reactions; ' +
    'DELETE FROM annotation_replies; DELETE FROM annotations; DELETE FROM stems; ' +
    'DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; ' +
    'DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
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
  dbMod.stmts.insertBand.run(id, 'Alpha', 'folder-x', ownerId, now);
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

function insertProject(bandId: string, userId: string): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertProject.run(
    id,
    bandId,
    'p1',
    null,
    'project-folder',
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
  projectId: string,
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
    projectId,
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

beforeEach(() => reset());

describe('reactions on annotations', () => {
  it('adds a reaction', async () => {
    const u = createUser('u@e.test');
    const bandId = createBand(u);
    const pid = insertProject(bandId, u);
    const annId = insertAnnotation(pid, u, 0, null, 'parent');
    const sid = createSession(u);

    const res = await app.request(`/api/annotations/${annId}/reactions`, {
      method: 'POST',
      headers: { cookie: cookie(sid), 'content-type': 'application/json' },
      body: JSON.stringify({ emoji: '👍' }),
    });
    expect(res.status).toBe(200);

    const row = dbMod.db
      .prepare(
        'SELECT COUNT(*) AS n FROM annotation_reactions WHERE annotation_id=? AND user_id=? AND emoji=?',
      )
      .get(annId, u, '👍') as { n: number };
    expect(row.n).toBe(1);
  });

  it('is idempotent on repeated add', async () => {
    const u = createUser('u@e.test');
    const bandId = createBand(u);
    const pid = insertProject(bandId, u);
    const annId = insertAnnotation(pid, u, 0, null, 'parent');
    const sid = createSession(u);

    for (let i = 0; i < 3; i++) {
      await app.request(`/api/annotations/${annId}/reactions`, {
        method: 'POST',
        headers: { cookie: cookie(sid), 'content-type': 'application/json' },
        body: JSON.stringify({ emoji: '👍' }),
      });
    }
    const row = dbMod.db
      .prepare('SELECT COUNT(*) AS n FROM annotation_reactions')
      .get() as { n: number };
    expect(row.n).toBe(1);
  });

  it('only deletes own reaction', async () => {
    const a = createUser('a@e.test');
    const b = createUser('b@e.test');
    const bandId = createBand(a);
    addMember(bandId, b);
    const pid = insertProject(bandId, a);
    const annId = insertAnnotation(pid, a, 0, null, 'parent');

    const aSid = createSession(a);
    const bSid = createSession(b);

    for (const sid of [aSid, bSid]) {
      await app.request(`/api/annotations/${annId}/reactions`, {
        method: 'POST',
        headers: { cookie: cookie(sid), 'content-type': 'application/json' },
        body: JSON.stringify({ emoji: '👍' }),
      });
    }
    const del = await app.request(`/api/annotations/${annId}/reactions`, {
      method: 'DELETE',
      headers: { cookie: cookie(bSid), 'content-type': 'application/json' },
      body: JSON.stringify({ emoji: '👍' }),
    });
    expect(del.status).toBe(204);

    const row = dbMod.db
      .prepare('SELECT user_id FROM annotation_reactions')
      .all() as { user_id: string }[];
    expect(row).toEqual([{ user_id: a }]);
  });

  it('accepts emoji as a query parameter on DELETE (proxy-safe)', async () => {
    const u = createUser('u@e.test');
    const bandId = createBand(u);
    const pid = insertProject(bandId, u);
    const annId = insertAnnotation(pid, u, 0, null, 'parent');
    const sid = createSession(u);

    await app.request(`/api/annotations/${annId}/reactions`, {
      method: 'POST',
      headers: { cookie: cookie(sid), 'content-type': 'application/json' },
      body: JSON.stringify({ emoji: '🎵' }),
    });

    const del = await app.request(
      `/api/annotations/${annId}/reactions?emoji=${encodeURIComponent('🎵')}`,
      { method: 'DELETE', headers: { cookie: cookie(sid) } },
    );
    expect(del.status).toBe(204);

    const row = dbMod.db
      .prepare('SELECT COUNT(*) AS n FROM annotation_reactions')
      .get() as { n: number };
    expect(row.n).toBe(0);
  });

  it('rejects empty or oversized emoji', async () => {
    const u = createUser('u@e.test');
    const bandId = createBand(u);
    const pid = insertProject(bandId, u);
    const annId = insertAnnotation(pid, u, 0, null, 'parent');
    const sid = createSession(u);

    for (const emoji of ['', 'x'.repeat(33)]) {
      const res = await app.request(`/api/annotations/${annId}/reactions`, {
        method: 'POST',
        headers: { cookie: cookie(sid), 'content-type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
      expect(res.status).toBe(400);
    }
  });

  it('non-member 404 on add', async () => {
    const owner = createUser('o@e.test');
    const stranger = createUser('s@e.test');
    const bandId = createBand(owner);
    const pid = insertProject(bandId, owner);
    const annId = insertAnnotation(pid, owner, 0, null, 'parent');
    const sid = createSession(stranger);

    const res = await app.request(`/api/annotations/${annId}/reactions`, {
      method: 'POST',
      headers: { cookie: cookie(sid), 'content-type': 'application/json' },
      body: JSON.stringify({ emoji: '👍' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('reactions on replies', () => {
  it('cascade-delete when reply is removed', async () => {
    const u = createUser('u@e.test');
    const bandId = createBand(u);
    const pid = insertProject(bandId, u);
    const annId = insertAnnotation(pid, u, 0, null, 'parent');
    const replyId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.insertReply.run(replyId, annId, u, 'hi', now, now);
    const sid = createSession(u);

    await app.request(`/api/annotation-replies/${replyId}/reactions`, {
      method: 'POST',
      headers: { cookie: cookie(sid), 'content-type': 'application/json' },
      body: JSON.stringify({ emoji: '🎵' }),
    });

    dbMod.stmts.deleteReply.run(replyId);
    const row = dbMod.db
      .prepare('SELECT COUNT(*) AS n FROM annotation_reply_reactions')
      .get() as { n: number };
    expect(row.n).toBe(0);
  });
});
