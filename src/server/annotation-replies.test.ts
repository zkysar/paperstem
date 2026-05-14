import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-reply-test-'));
process.env.DATABASE_PATH = join(tmpDir, 'test.sqlite');
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('./db.js');
type RepliesModule = typeof import('./annotation-replies.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let repliesMod: RepliesModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  repliesMod = await import('./annotation-replies.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.get('/api/annotations/:annotationId/replies', repliesMod.handleListReplies);
  app.post('/api/annotations/:annotationId/replies', repliesMod.handleCreateReply);
  app.patch('/api/annotation-replies/:id', repliesMod.handlePatchReply);
  app.delete('/api/annotation-replies/:id', repliesMod.handleDeleteReply);
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

describe('replies', () => {
  it('member can create a reply', async () => {
    const author = createUser('a@e.test', 'Author');
    const replier = createUser('r@e.test', 'Replier');
    const bandId = createBand(author);
    addMember(bandId, replier);
    const pid = insertProject(bandId, author);
    const annId = insertAnnotation(pid, author, 0, null, 'parent');
    const sid = createSession(replier);

    const res = await app.request(`/api/annotations/${annId}/replies`, {
      method: 'POST',
      headers: { cookie: cookie(sid), 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'hello' }),
    });

    expect(res.status).toBe(201);
    const { reply } = (await res.json()) as {
      reply: { id: string; body: string; reactions: unknown[]; user_email: string };
    };
    expect(reply.body).toBe('hello');
    expect(reply.user_email).toBe('r@e.test');
    expect(reply.reactions).toEqual([]);
  });

  it('lists replies in created_at order', async () => {
    const u = createUser('u@e.test');
    const bandId = createBand(u);
    const pid = insertProject(bandId, u);
    const annId = insertAnnotation(pid, u, 0, null, 'parent');
    const sid = createSession(u);

    for (const body of ['first', 'second', 'third']) {
      await app.request(`/api/annotations/${annId}/replies`, {
        method: 'POST',
        headers: { cookie: cookie(sid), 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
    }
    const res = await app.request(`/api/annotations/${annId}/replies`, {
      headers: { cookie: cookie(sid) },
    });
    expect(res.status).toBe(200);
    const { replies } = (await res.json()) as { replies: { body: string }[] };
    expect(replies.map((r) => r.body)).toEqual(['first', 'second', 'third']);
  });

  it('non-member gets 404 on list', async () => {
    const owner = createUser('o@e.test');
    const stranger = createUser('s@e.test');
    const bandId = createBand(owner);
    const pid = insertProject(bandId, owner);
    const annId = insertAnnotation(pid, owner, 0, null, 'parent');
    const sid = createSession(stranger);

    const res = await app.request(`/api/annotations/${annId}/replies`, {
      headers: { cookie: cookie(sid) },
    });
    expect(res.status).toBe(404);
  });

  it('non-author cannot edit or delete a reply', async () => {
    const author = createUser('a@e.test');
    const member = createUser('m@e.test');
    const bandId = createBand(author);
    addMember(bandId, member);
    const pid = insertProject(bandId, author);
    const annId = insertAnnotation(pid, author, 0, null, 'parent');

    const aSid = createSession(author);
    const createRes = await app.request(`/api/annotations/${annId}/replies`, {
      method: 'POST',
      headers: { cookie: cookie(aSid), 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'mine' }),
    });
    const { reply } = (await createRes.json()) as { reply: { id: string } };

    const mSid = createSession(member);
    const patchRes = await app.request(`/api/annotation-replies/${reply.id}`, {
      method: 'PATCH',
      headers: { cookie: cookie(mSid), 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'tampered' }),
    });
    expect(patchRes.status).toBe(403);

    const delRes = await app.request(`/api/annotation-replies/${reply.id}`, {
      method: 'DELETE',
      headers: { cookie: cookie(mSid) },
    });
    expect(delRes.status).toBe(403);
  });

  it('rejects empty body and body over 32 KB', async () => {
    const u = createUser('u@e.test');
    const bandId = createBand(u);
    const pid = insertProject(bandId, u);
    const annId = insertAnnotation(pid, u, 0, null, 'parent');
    const sid = createSession(u);

    const empty = await app.request(`/api/annotations/${annId}/replies`, {
      method: 'POST',
      headers: { cookie: cookie(sid), 'content-type': 'application/json' },
      body: JSON.stringify({ body: '' }),
    });
    expect(empty.status).toBe(400);

    const tooLong = await app.request(`/api/annotations/${annId}/replies`, {
      method: 'POST',
      headers: { cookie: cookie(sid), 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'x'.repeat(32769) }),
    });
    expect(tooLong.status).toBe(400);
  });

  it('cascade-deletes replies and reactions when parent annotation is deleted', async () => {
    const u = createUser('u@e.test');
    const bandId = createBand(u);
    const pid = insertProject(bandId, u);
    const annId = insertAnnotation(pid, u, 0, null, 'parent');
    const sid = createSession(u);

    const createRes = await app.request(`/api/annotations/${annId}/replies`, {
      method: 'POST',
      headers: { cookie: cookie(sid), 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'r1' }),
    });
    const { reply } = (await createRes.json()) as { reply: { id: string } };

    dbMod.stmts.insertReplyReaction.run(reply.id, u, '👍', 1);

    dbMod.stmts.deleteAnnotation.run(annId);

    expect(
      dbMod.db.prepare('SELECT COUNT(*) AS n FROM annotation_replies').get(),
    ).toEqual({ n: 0 });
    expect(
      dbMod.db
        .prepare('SELECT COUNT(*) AS n FROM annotation_reply_reactions')
        .get(),
    ).toEqual({ n: 0 });
  });
});
