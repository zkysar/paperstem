import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-public-links-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
const audioRoot = join(tmpDir, 'audio');
mkdirSync(audioRoot, { recursive: true });
process.env.DATABASE_PATH = dbPath;
process.env.PAPERSTEM_AUDIO_ROOT = audioRoot;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('./db.js');
type PublicLinksModule = typeof import('./public-links.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let publicMod: PublicLinksModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  publicMod = await import('./public-links.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  // Management
  app.get('/api/projects/:id/public-links', publicMod.handleListPublicLinks);
  app.post('/api/projects/:id/public-links', publicMod.handleCreatePublicLink);
  app.delete('/api/public-links/:token', publicMod.handleRevokePublicLink);
  // Public read
  app.get('/api/public/links/:token', publicMod.handleGetPublicProject);
  app.get('/api/public/links/:token/audio/:stem_id', publicMod.handleGetPublicAudio);
  app.get(
    '/api/public/links/:token/annotations',
    publicMod.handleListPublicAnnotations,
  );
  app.get(
    '/api/public/links/:token/annotations/:annotationId/replies',
    publicMod.handleListPublicReplies,
  );
  app.get('/api/public/links/:token/sections', publicMod.handleListPublicSections);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function encodeId(rel: string): string {
  return Buffer.from(rel, 'utf8').toString('base64url');
}

function reset() {
  dbMod.db.exec(
    'DELETE FROM annotation_reply_reactions; DELETE FROM annotation_reactions; DELETE FROM annotation_replies; DELETE FROM annotations; DELETE FROM sections; DELETE FROM songs; DELETE FROM public_links; DELETE FROM stems; DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users; DELETE FROM audit_log;',
  );
  rmSync(audioRoot, { recursive: true, force: true });
  mkdirSync(audioRoot, { recursive: true });
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

function insertProject(
  bandId: string,
  bandName: string,
  ownerId: string,
  name: string,
): { id: string; folderRel: string; folderId: string } {
  const id = randomUUID();
  const folderRel = `${bandName}/${name}`;
  const folderId = encodeId(folderRel);
  mkdirSync(join(audioRoot, folderRel), { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertProject.run(
    id,
    bandId,
    name,
    null,
    folderId,
    null,
    now,
    ownerId,
    now,
  );
  return { id, folderRel, folderId };
}

function insertStem(
  projectId: string,
  folderRel: string,
  name: string,
  position: number,
  audioBytes?: Buffer,
): { id: string; fileId: string } {
  const id = randomUUID();
  const fileRel = `${folderRel}/${name}.mp3`;
  if (audioBytes) {
    writeFileSync(join(audioRoot, fileRel), audioBytes);
  }
  dbMod.stmts.insertStem.run(
    id,
    projectId,
    name,
    position,
    encodeId(fileRel),
    null,
    audioBytes?.length ?? 1024,
    null,
  );
  return { id, fileId: encodeId(fileRel) };
}

function insertAnnotation(
  projectId: string,
  userId: string,
  body: string,
  startMs = 0,
): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertAnnotation.run(
    id,
    projectId,
    userId,
    startMs,
    null,
    body,
    0,
    now,
    now,
  );
  return id;
}

function insertReply(annotationId: string, userId: string, body: string): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertReply.run(id, annotationId, userId, body, now, now);
  return id;
}

function insertSection(
  projectId: string,
  userId: string,
  startMs: number,
  label: string,
): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertSection.run(
    id,
    projectId,
    startMs,
    null,
    label,
    'manual',
    now,
    userId,
    now,
  );
  return id;
}

beforeEach(() => {
  reset();
});

describe('POST /api/projects/:id/public-links', () => {
  it('rejects unauthenticated requests', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    const res = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, { method: 'POST' }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members (no leak)', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('creates a token and writes an audit row', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      link: { token: string; created_by_email: string };
    };
    expect(body.link.token).toMatch(/^pls_/);
    expect(body.link.created_by_email).toBe('owner@example.com');

    const auditRows = dbMod.db
      .prepare(
        `SELECT action, resource_id FROM audit_log WHERE action = 'public_link.create'`,
      )
      .all() as { action: string; resource_id: string }[];
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].resource_id).toBe(body.link.token);
  });
});

describe('DELETE /api/public-links/:token', () => {
  it('returns 404 for unknown tokens (does not echo back)', async () => {
    const owner = createUser('owner@example.com');
    createBand('Alpha', owner);
    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/public-links/pls_aaaaaaaaaaaaaaaaaaaaaaaa`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('rejects non-members of the linked project (no leak)', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    const ownerSid = createSession(owner);
    const create = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(ownerSid) },
      }),
    );
    const { link } = (await create.json()) as { link: { token: string } };

    const strangerSid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/public-links/${link.token}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(strangerSid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('revokes a link and is idempotent', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    const sid = createSession(owner);
    const create = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link } = (await create.json()) as { link: { token: string } };

    const r1 = await app.fetch(
      new Request(`http://x/api/public-links/${link.token}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(r1.status).toBe(204);
    const r2 = await app.fetch(
      new Request(`http://x/api/public-links/${link.token}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(r2.status).toBe(204);
  });
});

describe('GET /api/public/links/:token', () => {
  it('returns 404 for malformed tokens (no DB lookup)', async () => {
    const res = await app.fetch(new Request(`http://x/api/public/links/not-a-token`));
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown tokens', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/public/links/pls_aaaaaaaaaaaaaaaaaaaaaaaa`),
    );
    expect(res.status).toBe(404);
  });

  it('returns project + band name + stems for valid token (no session)', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid, folderRel } = insertProject(bandId, 'Alpha', owner, 'p1');
    insertStem(pid, folderRel, 'drums', 0);
    insertStem(pid, folderRel, 'bass', 1);
    const sid = createSession(owner);
    const create = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link } = (await create.json()) as { link: { token: string } };

    // No cookie sent — public read path.
    const res = await app.fetch(
      new Request(`http://x/api/public/links/${link.token}`),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    // Critical: the public payload must not leak storage file ids.
    expect(text).not.toMatch(/file_id/);
    const body = JSON.parse(text) as {
      project: { name: string; band_name: string };
      stems: { name: string; position: number }[];
    };
    expect(body.project.name).toBe('p1');
    expect(body.project.band_name).toBe('Alpha');
    expect(body.stems.map((s) => s.name)).toEqual(['drums', 'bass']);
  });

  it('returns 410 for revoked tokens', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    const sid = createSession(owner);
    const create = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link } = (await create.json()) as { link: { token: string } };
    await app.fetch(
      new Request(`http://x/api/public-links/${link.token}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );

    const res = await app.fetch(
      new Request(`http://x/api/public/links/${link.token}`),
    );
    expect(res.status).toBe(410);
  });

  it('returns 410 when the underlying project is soft-deleted', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    const sid = createSession(owner);
    const create = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link } = (await create.json()) as { link: { token: string } };

    dbMod.stmts.softDeleteProject.run(
      Math.floor(Date.now() / 1000),
      owner,
      pid,
    );

    const res = await app.fetch(
      new Request(`http://x/api/public/links/${link.token}`),
    );
    expect(res.status).toBe(410);
  });
});

describe('GET /api/public/links/:token/audio/:stem_id (cross-project lockout)', () => {
  it("denies stems that don't belong to the token's project", async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid1, folderRel: f1 } = insertProject(bandId, 'Alpha', owner, 'p1');
    const { id: pid2, folderRel: f2 } = insertProject(bandId, 'Alpha', owner, 'p2');
    insertStem(pid1, f1, 'p1-drums', 0, Buffer.from('p1-audio'));
    const { id: stem2Id } = insertStem(
      pid2,
      f2,
      'p2-drums',
      0,
      Buffer.from('p2-audio'),
    );

    const sid = createSession(owner);
    // Mint a link for p1 only.
    const create = await app.fetch(
      new Request(`http://x/api/projects/${pid1}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link } = (await create.json()) as { link: { token: string } };

    // Try to fetch p2's stem with p1's token: 404.
    const res = await app.fetch(
      new Request(
        `http://x/api/public/links/${link.token}/audio/${encodeURIComponent(stem2Id)}`,
      ),
    );
    expect(res.status).toBe(404);
  });

  it('serves the token-project stem to anonymous clients', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid, folderRel } = insertProject(bandId, 'Alpha', owner, 'p1');
    const { id: stemId } = insertStem(
      pid,
      folderRel,
      'drums',
      0,
      Buffer.from('hello-audio'),
    );

    const sid = createSession(owner);
    const create = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link } = (await create.json()) as { link: { token: string } };

    const res = await app.fetch(
      new Request(
        `http://x/api/public/links/${link.token}/audio/${encodeURIComponent(stemId)}`,
      ),
    );
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes).toString()).toBe('hello-audio');
  });
});

describe('GET /api/public/links/:token/annotations (read-only, stripped)', () => {
  it('returns annotations with display name only, no user_email / user_id', async () => {
    const owner = createUser('owner@example.com');
    // Set a display name so we can prove emails aren't leaked.
    dbMod.db
      .prepare(`UPDATE users SET display_name = 'Owner Name' WHERE id = ?`)
      .run(owner);
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    insertAnnotation(pid, owner, 'hello world', 1000);

    const sid = createSession(owner);
    const create = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link } = (await create.json()) as { link: { token: string } };

    const res = await app.fetch(
      new Request(`http://x/api/public/links/${link.token}/annotations`),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    // No user_email and no user_id (which is a stable identifier and could
    // be cross-referenced with other tokens to enumerate band members).
    expect(text).not.toMatch(/user_email/);
    expect(text).not.toMatch(/"user_id"/);
    expect(text).toMatch(/Owner Name/);
    expect(text).toMatch(/hello world/);
  });
});

describe('GET /api/public/links/:token/annotations/:annotationId/replies', () => {
  it('rejects replies for annotations outside the token project', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid1 } = insertProject(bandId, 'Alpha', owner, 'p1');
    const { id: pid2 } = insertProject(bandId, 'Alpha', owner, 'p2');
    const annInP2 = insertAnnotation(pid2, owner, 'p2 comment');
    insertReply(annInP2, owner, 'a reply');

    const sid = createSession(owner);
    const create = await app.fetch(
      new Request(`http://x/api/projects/${pid1}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link } = (await create.json()) as { link: { token: string } };

    const res = await app.fetch(
      new Request(
        `http://x/api/public/links/${link.token}/annotations/${annInP2}/replies`,
      ),
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/public/links/:token/sections', () => {
  it('lists sections without exposing created_by user id', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    insertSection(pid, owner, 0, 'intro');

    const sid = createSession(owner);
    const create = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link } = (await create.json()) as { link: { token: string } };

    const res = await app.fetch(
      new Request(`http://x/api/public/links/${link.token}/sections`),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/created_by/);
    expect(text).toMatch(/intro/);
  });
});

describe('Public read endpoints never set a session cookie', () => {
  it('the bootstrap GET issues no Set-Cookie even if the token is valid', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    const sid = createSession(owner);
    const create = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link } = (await create.json()) as { link: { token: string } };

    const res = await app.fetch(
      new Request(`http://x/api/public/links/${link.token}`),
    );
    expect(res.status).toBe(200);
    // A cookie here would indicate the public path is touching the auth
    // layer, which it must never do. Both header forms checked.
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });
});

describe('GET /api/projects/:id/public-links (list, owner UI)', () => {
  it('returns 401 unauthenticated', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/projects/anything/public-links`),
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members (no leak of project existence)', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('lists live and revoked links with correct per-link revocation state', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    const sid = createSession(owner);
    // Create two, revoke one.
    const c1 = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link: l1 } = (await c1.json()) as { link: { token: string } };
    await app.fetch(
      new Request(`http://x/api/public-links/${l1.token}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const c2 = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link: l2 } = (await c2.json()) as { link: { token: string } };

    const res = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      links: { token: string; revoked_at: number | null }[];
    };
    expect(body.links.length).toBe(2);
    // Don't assert ordering — created_at is integer-seconds so two creates
    // in the same second tie. Look up each token explicitly.
    const byToken = new Map(body.links.map((l) => [l.token, l]));
    expect(byToken.get(l1.token)?.revoked_at).not.toBeNull();
    expect(byToken.get(l2.token)?.revoked_at).toBeNull();
  });

  it('still lists links on a trashed project so the owner can audit them', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    const sid = createSession(owner);
    await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    // Soft-delete the project.
    dbMod.stmts.softDeleteProject.run(
      Math.floor(Date.now() / 1000),
      owner,
      pid,
    );

    const res = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { links: unknown[] };
    expect(body.links.length).toBe(1);
  });
});

describe('Audit logging covers create AND revoke', () => {
  it('writes a public_link.revoke row when an owner revokes a link', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    const sid = createSession(owner);
    const create = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link } = (await create.json()) as { link: { token: string } };
    await app.fetch(
      new Request(`http://x/api/public-links/${link.token}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const rows = dbMod.db
      .prepare(
        `SELECT action, resource_id, user_email
           FROM audit_log WHERE action = 'public_link.revoke'`,
      )
      .all() as { action: string; resource_id: string; user_email: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].resource_id).toBe(link.token);
    expect(rows[0].user_email).toBe('owner@example.com');
  });

  it('does not double-audit an idempotent re-revoke', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    const sid = createSession(owner);
    const create = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link } = (await create.json()) as { link: { token: string } };
    for (let i = 0; i < 3; i++) {
      await app.fetch(
        new Request(`http://x/api/public-links/${link.token}`, {
          method: 'DELETE',
          headers: { cookie: cookieHeader(sid) },
        }),
      );
    }
    const n = dbMod.db
      .prepare(
        `SELECT COUNT(*) AS c FROM audit_log WHERE action = 'public_link.revoke'`,
      )
      .get() as { c: number };
    expect(n.c).toBe(1);
  });
});

describe('Trash policy on public links', () => {
  it('auto-revokes live links with revoked_reason=trash when project is trashed', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    const sid = createSession(owner);
    const create = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link } = (await create.json()) as { link: { token: string } };

    // Simulate the trash transaction (the handler is in projects.ts, not
    // mounted on this test app — call the statements directly).
    const now = Math.floor(Date.now() / 1000);
    dbMod.db.transaction(() => {
      dbMod.stmts.softDeleteProject.run(now, owner, pid);
      dbMod.stmts.trashRevokePublicLinksForProject.run(now, pid);
    })();

    const row = dbMod.stmts.findPublicLinkByToken.get(link.token);
    expect(row?.revoked_at).not.toBeNull();
    expect(row?.revoked_reason).toBe('trash');

    // The public path now returns 410.
    const res = await app.fetch(
      new Request(`http://x/api/public/links/${link.token}`),
    );
    expect(res.status).toBe(410);
  });

  it('restore re-activates trash-revoked links but NOT user-revoked links', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    const sid = createSession(owner);
    // Two links: one user-revokes before trash, the other is live.
    const c1 = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link: userRevoked } = (await c1.json()) as {
      link: { token: string };
    };
    await app.fetch(
      new Request(`http://x/api/public-links/${userRevoked.token}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const c2 = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link: live } = (await c2.json()) as { link: { token: string } };

    // Trash, then restore.
    const now = Math.floor(Date.now() / 1000);
    dbMod.db.transaction(() => {
      dbMod.stmts.softDeleteProject.run(now, owner, pid);
      dbMod.stmts.trashRevokePublicLinksForProject.run(now, pid);
    })();
    dbMod.db.transaction(() => {
      dbMod.stmts.restoreProject.run(pid);
      dbMod.stmts.reactivatePublicLinksForTrashRestore.run(pid);
    })();

    const userRow = dbMod.stmts.findPublicLinkByToken.get(userRevoked.token);
    const liveRow = dbMod.stmts.findPublicLinkByToken.get(live.token);
    expect(userRow?.revoked_at).not.toBeNull();
    expect(userRow?.revoked_reason).toBe('user');
    expect(liveRow?.revoked_at).toBeNull();
    expect(liveRow?.revoked_reason).toBeNull();
  });
});

describe('Public audio HTTP semantics', () => {
  it('honors Range requests with 206 + Content-Range', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid, folderRel } = insertProject(bandId, 'Alpha', owner, 'p1');
    const { id: stemId } = insertStem(
      pid,
      folderRel,
      'drums',
      0,
      Buffer.from('0123456789abcdef'),
    );
    const sid = createSession(owner);
    const create = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link } = (await create.json()) as { link: { token: string } };

    const res = await app.fetch(
      new Request(
        `http://x/api/public/links/${link.token}/audio/${encodeURIComponent(stemId)}`,
        { headers: { range: 'bytes=4-9' } },
      ),
    );
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 4-9/16');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes).toString()).toBe('456789');
  });

  it('serves audio with Cache-Control: public so shared caches absorb hits', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid, folderRel } = insertProject(bandId, 'Alpha', owner, 'p1');
    const { id: stemId } = insertStem(
      pid,
      folderRel,
      'drums',
      0,
      Buffer.from('hello'),
    );
    const sid = createSession(owner);
    const create = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link } = (await create.json()) as { link: { token: string } };
    const res = await app.fetch(
      new Request(
        `http://x/api/public/links/${link.token}/audio/${encodeURIComponent(stemId)}`,
      ),
    );
    expect(res.headers.get('cache-control')).toContain('public');
    expect(res.headers.get('cache-control')).not.toContain('private');
  });
});

describe('Public annotations payload includes aggregated reactions', () => {
  it('returns reactions with emoji + count, no user_ids leak', async () => {
    const owner = createUser('owner@example.com');
    const other = createUser('other@example.com');
    const bandId = createBand('Alpha', owner);
    const { id: pid } = insertProject(bandId, 'Alpha', owner, 'p1');
    const annId = insertAnnotation(pid, owner, 'rate me', 0);
    // Two reactions on the same emoji.
    dbMod.stmts.insertReaction.run(
      annId,
      owner,
      '🔥',
      Math.floor(Date.now() / 1000),
    );
    dbMod.stmts.insertReaction.run(
      annId,
      other,
      '🔥',
      Math.floor(Date.now() / 1000),
    );

    const sid = createSession(owner);
    const create = await app.fetch(
      new Request(`http://x/api/projects/${pid}/public-links`, {
        method: 'POST',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const { link } = (await create.json()) as { link: { token: string } };

    const res = await app.fetch(
      new Request(`http://x/api/public/links/${link.token}/annotations`),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/user_ids/);
    expect(text).not.toMatch(/reacted_by_self/);
    const body = JSON.parse(text) as {
      annotations: { reactions: { emoji: string; count: number }[] }[];
    };
    expect(body.annotations[0].reactions).toEqual([{ emoji: '🔥', count: 2 }]);
  });
});
