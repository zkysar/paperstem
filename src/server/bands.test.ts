import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-bands-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
const audioRoot = join(tmpDir, 'audio');
process.env.DATABASE_PATH = dbPath;
process.env.PAPERSTEM_AUDIO_ROOT = audioRoot;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';
// Stop the invite-member handler from actually trying to send mail in
// tests — handler reads this env var each request.
process.env.PAPERSTEM_SKIP_MAIL = '1';

type DbModule = typeof import('./db.js');
type BandsModule = typeof import('./bands.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let bandsMod: BandsModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  bandsMod = await import('./bands.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.get('/api/bands', bandsMod.handleListBands);
  app.post('/api/bands', bandsMod.handleCreateBand);
  app.get('/api/bands/:id', bandsMod.handleGetBand);
  app.patch('/api/bands/:id', bandsMod.handleRenameBand);
  app.delete('/api/bands/:id', bandsMod.handleDeleteBand);
  app.post('/api/bands/:id/members', bandsMod.handleInviteMember);
  app.delete('/api/bands/:id/members/me', bandsMod.handleLeaveBand);
  app.delete(
    '/api/bands/:id/members/:userId',
    bandsMod.handleRemoveMember,
  );
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function resetTables() {
  dbMod.db.exec(
    'DELETE FROM audit_log; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
}

function createUser(email: string): string {
  const id = randomUUID();
  dbMod.stmts.insertUser.run(id, email, null, Math.floor(Date.now() / 1000));
  return id;
}

function createBand(name: string, ownerId: string, folderId = 'folder-x') {
  const id = randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertBand.run(id, name, folderId, ownerId, createdAt);
  dbMod.stmts.insertMembership.run(id, ownerId, 'owner', createdAt);
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

function createSession(userId: string): string {
  const sid = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertSession.run(sid, userId, now + 3600, now);
  return sid;
}

function cookieHeader(sessionId: string): string {
  return `${cookieMod.SESSION_COOKIE_NAME}=${sessionId}`;
}

beforeEach(() => {
  resetTables();
});

describe('GET /api/bands', () => {
  it('requires authentication', async () => {
    const res = await app.fetch(new Request('http://x/api/bands'));
    expect(res.status).toBe(401);
  });

  it("returns the calling user's bands with role", async () => {
    const owner = createUser('owner@example.com');
    const member = createUser('member@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, member);
    createBand('Other', stranger);

    const sid = createSession(member);
    const res = await app.fetch(
      new Request('http://x/api/bands', {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bands: { id: string; role: string }[] };
    expect(body.bands).toHaveLength(1);
    expect(body.bands[0].id).toBe(bandId);
    expect(body.bands[0].role).toBe('member');
  });

  it('returns empty list when user has no bands', async () => {
    const u = createUser('lonely@example.com');
    const sid = createSession(u);
    const res = await app.fetch(
      new Request('http://x/api/bands', {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bands: unknown[] };
    expect(body.bands).toEqual([]);
  });
});

describe('GET /api/bands/:id', () => {
  it('requires authentication', async () => {
    const res = await app.fetch(new Request('http://x/api/bands/anything'));
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members (does not leak existence)', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Secret Society', owner);

    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-existent band', async () => {
    const u = createUser('u@example.com');
    const sid = createSession(u);
    const res = await app.fetch(
      new Request('http://x/api/bands/does-not-exist', {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns band detail with members when caller is a member', async () => {
    const owner = createUser('owner@example.com');
    const member = createUser('member@example.com');
    const bandId = createBand('Alpha', owner, 'folder-abc');
    addMember(bandId, member);

    const sid = createSession(member);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      band: { id: string; name: string; folder_id: string };
      members: { email: string; role: string }[];
    };
    expect(body.band.id).toBe(bandId);
    expect(body.band.name).toBe('Alpha');
    expect(body.band.folder_id).toBe('folder-abc');
    expect(body.members).toHaveLength(2);
    const emails = body.members.map((m) => m.email).sort();
    expect(emails).toEqual(['member@example.com', 'owner@example.com']);
    const ownerEntry = body.members.find(
      (m) => m.email === 'owner@example.com',
    );
    expect(ownerEntry?.role).toBe('owner');
  });
});

describe('POST /api/bands', () => {
  it('requires authentication', async () => {
    const res = await app.fetch(
      new Request('http://x/api/bands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Anything' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects missing or blank name', async () => {
    const u = createUser('u@example.com');
    const sid = createSession(u);
    for (const body of [{}, { name: '' }, { name: '   ' }]) {
      const res = await app.fetch(
        new Request('http://x/api/bands', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: cookieHeader(sid),
          },
          body: JSON.stringify(body),
        }),
      );
      expect(res.status).toBe(400);
    }
  });

  it('rejects names that would break the storage layer (slash, backslash, dot, control char)', async () => {
    const u = createUser('u@example.com');
    const sid = createSession(u);
    for (const badName of ['AC/DC', 'foo\\bar', '.', '..', 'bell\x07', '/etc/passwd']) {
      const res = await app.fetch(
        new Request('http://x/api/bands', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: cookieHeader(sid),
          },
          body: JSON.stringify({ name: badName }),
        }),
      );
      expect(res.status, `name=${JSON.stringify(badName)}`).toBe(400);
      const body = (await res.json()) as { error: string };
      // Either name_invalid (typical) or name_required (for "" after trim
      // edge cases). Just assert it's a 400 with a known error code.
      expect(['name_invalid', 'name_required']).toContain(body.error);
    }
  });

  it('rejects names longer than 80 chars', async () => {
    const u = createUser('u@example.com');
    const sid = createSession(u);
    const res = await app.fetch(
      new Request('http://x/api/bands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ name: 'a'.repeat(81) }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('creates a band with the caller as owner', async () => {
    const u = createUser('founder@example.com');
    const sid = createSession(u);
    const res = await app.fetch(
      new Request('http://x/api/bands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ name: 'New Wave' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      band: { id: string; name: string; role: string; owner_user_id: string };
    };
    expect(body.band.name).toBe('New Wave');
    expect(body.band.role).toBe('owner');
    expect(body.band.owner_user_id).toBe(u);

    // Membership row exists for the caller as owner.
    const ms = dbMod.stmts.findMembership.get(body.band.id, u);
    expect(ms).not.toBeUndefined();
    expect(ms?.role).toBe('owner');

    // GET /api/bands now includes it.
    const listRes = await app.fetch(
      new Request('http://x/api/bands', {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const listBody = (await listRes.json()) as {
      bands: { id: string; name: string }[];
    };
    expect(listBody.bands.map((b) => b.name)).toContain('New Wave');
  });

  it('trims whitespace before storing the name', async () => {
    const u = createUser('founder@example.com');
    const sid = createSession(u);
    const res = await app.fetch(
      new Request('http://x/api/bands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ name: '  Spacey  ' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { band: { name: string } };
    expect(body.band.name).toBe('Spacey');
  });

  it('returns 409 when the same user already owns a band with that name', async () => {
    const u = createUser('founder@example.com');
    const sid = createSession(u);
    const first = await app.fetch(
      new Request('http://x/api/bands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ name: 'Twin' }),
      }),
    );
    expect(first.status).toBe(201);
    const second = await app.fetch(
      new Request('http://x/api/bands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ name: 'Twin' }),
      }),
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe('duplicate_name');
  });

  it('allows two different owners to have a band with the same name', async () => {
    const a = createUser('a@example.com');
    const b = createUser('b@example.com');
    const sidA = createSession(a);
    const sidB = createSession(b);
    const r1 = await app.fetch(
      new Request('http://x/api/bands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sidA),
        },
        body: JSON.stringify({ name: 'Shared' }),
      }),
    );
    expect(r1.status).toBe(201);
    const r2 = await app.fetch(
      new Request('http://x/api/bands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sidB),
        },
        body: JSON.stringify({ name: 'Shared' }),
      }),
    );
    expect(r2.status).toBe(201);
  });

  it('rejects bad JSON body', async () => {
    const u = createUser('u@example.com');
    const sid = createSession(u);
    const res = await app.fetch(
      new Request('http://x/api/bands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: 'not-json',
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/bands/:id/members', () => {
  it('requires authentication', async () => {
    const res = await app.fetch(
      new Request('http://x/api/bands/anything/members', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'someone@example.com' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 for a band the caller is not in (no existence leak)', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);

    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ email: 'new@example.com' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 403 when caller is a non-owner member', async () => {
    const owner = createUser('owner@example.com');
    const member = createUser('member@example.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, member);

    const sid = createSession(member);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ email: 'new@example.com' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('rejects missing or invalid email', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const sid = createSession(owner);
    for (const body of [
      { email: '' },
      { email: 'not-an-email' },
      { email: 'no-at-sign.example.com' },
      {},
    ]) {
      const res = await app.fetch(
        new Request(`http://x/api/bands/${bandId}/members`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: cookieHeader(sid),
          },
          body: JSON.stringify(body),
        }),
      );
      expect(res.status).toBe(400);
    }
  });

  it('creates a user row if the invitee does not exist and adds them as a member', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const sid = createSession(owner);
    expect(dbMod.stmts.findUserByEmail.get('newbie@example.com')).toBeUndefined();

    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ email: 'newbie@example.com' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      member: { id: string; email: string; role: string };
      mailed: boolean;
    };
    expect(body.member.email).toBe('newbie@example.com');
    expect(body.member.role).toBe('member');
    // No email goes out under PAPERSTEM_SKIP_MAIL=1.
    expect(body.mailed).toBe(false);

    const created = dbMod.stmts.findUserByEmail.get('newbie@example.com');
    expect(created).not.toBeUndefined();
    expect(
      dbMod.stmts.findMembership.get(bandId, body.member.id),
    ).not.toBeUndefined();
  });

  it('reuses the existing user row when the invitee already has an account', async () => {
    const owner = createUser('owner@example.com');
    const existing = createUser('existing@example.com');
    const bandId = createBand('Alpha', owner);
    const sid = createSession(owner);

    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ email: 'existing@example.com' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { member: { id: string } };
    expect(body.member.id).toBe(existing);
  });

  it('lowercases the email before lookup/insert', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const sid = createSession(owner);

    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ email: '  CaPs@Example.COM  ' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { member: { email: string } };
    expect(body.member.email).toBe('caps@example.com');
  });

  it('returns 409 when the invitee is already a member', async () => {
    const owner = createUser('owner@example.com');
    const existing = createUser('existing@example.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, existing);
    const sid = createSession(owner);

    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ email: 'existing@example.com' }),
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('already_member');
  });

  it('returns 409 when the invitee is the owner themself', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const sid = createSession(owner);

    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ email: 'owner@example.com' }),
      }),
    );
    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/bands/:id', () => {
  it('requires authentication', async () => {
    const res = await app.fetch(
      new Request('http://x/api/bands/anything', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('non-owner members get 403', async () => {
    const owner = createUser('owner@example.com');
    const member = createUser('member@example.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, member);
    const sid = createSession(member);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ name: 'Renamed' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('non-members get 404 (no existence leak)', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);
    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ name: 'Renamed' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('renames the band when the owner submits a new name', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ name: '  Alpha 2  ' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { band: { name: string } };
    expect(body.band.name).toBe('Alpha 2');
    expect(dbMod.stmts.findBandById.get(bandId)?.name).toBe('Alpha 2');
  });

  it('no-op rename (same name) returns 200 without errors', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ name: 'Alpha' }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it('returns 409 when the new name collides with another owner-mine band', async () => {
    const owner = createUser('owner@example.com');
    const idA = createBand('Alpha', owner);
    createBand('Beta', owner);
    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${idA}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ name: 'Beta' }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it('rejects blank or oversize names', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const sid = createSession(owner);
    for (const body of [{ name: '' }, { name: '   ' }, { name: 'a'.repeat(81) }]) {
      const res = await app.fetch(
        new Request(`http://x/api/bands/${bandId}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            cookie: cookieHeader(sid),
          },
          body: JSON.stringify(body),
        }),
      );
      expect(res.status).toBe(400);
    }
  });
});

describe('DELETE /api/bands/:id/members/:userId', () => {
  it('requires authentication', async () => {
    const res = await app.fetch(
      new Request('http://x/api/bands/anything/members/someone', {
        method: 'DELETE',
      }),
    );
    expect(res.status).toBe(401);
  });

  it('non-owner members get 403', async () => {
    const owner = createUser('owner@example.com');
    const memberA = createUser('a@example.com');
    const memberB = createUser('b@example.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, memberA);
    addMember(bandId, memberB);
    const sid = createSession(memberA);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members/${memberB}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('owner cannot remove themselves through this endpoint', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members/${owner}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(409);
    expect(
      dbMod.stmts.findMembership.get(bandId, owner),
    ).not.toBeUndefined();
  });

  it('owner can remove another member', async () => {
    const owner = createUser('owner@example.com');
    const member = createUser('member@example.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, member);
    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members/${member}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);
    expect(dbMod.stmts.findMembership.get(bandId, member)).toBeUndefined();
    // Owner unaffected.
    expect(
      dbMod.stmts.findMembership.get(bandId, owner),
    ).not.toBeUndefined();
  });

  it('removing a non-member returns 404', async () => {
    const owner = createUser('owner@example.com');
    const ghost = createUser('ghost@example.com');
    const bandId = createBand('Alpha', owner);
    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members/${ghost}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/bands/:id/members/me', () => {
  it('requires authentication', async () => {
    const res = await app.fetch(
      new Request('http://x/api/bands/anything/members/me', {
        method: 'DELETE',
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when the user is not a member (no existence leak)', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);

    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members/me`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 409 owner_must_transfer when the owner leaves without a transferTo', async () => {
    const owner = createUser('owner@example.com');
    const member = createUser('member@example.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, member);

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members/me`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('owner_must_transfer');

    // Nothing changed: owner is still in the band as owner, member as member.
    expect(dbMod.stmts.findMembership.get(bandId, owner)?.role).toBe('owner');
    expect(dbMod.stmts.findMembership.get(bandId, member)?.role).toBe('member');
  });

  it('owner can leave by transferring ownership to a member', async () => {
    const owner = createUser('owner@example.com');
    const member = createUser('member@example.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, member);

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members/me`, {
        method: 'DELETE',
        headers: {
          cookie: cookieHeader(sid),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ transferTo: member }),
      }),
    );
    expect(res.status).toBe(200);

    // Old owner is gone, member is promoted, bands.owner_user_id is repointed.
    expect(dbMod.stmts.findMembership.get(bandId, owner)).toBeUndefined();
    expect(dbMod.stmts.findMembership.get(bandId, member)?.role).toBe('owner');
    expect(dbMod.stmts.findBandById.get(bandId)?.owner_user_id).toBe(member);

    const rows = dbMod.db
      .prepare(
        `SELECT action, user_id, metadata FROM audit_log
          WHERE resource_type = 'band' AND resource_id = ?`,
      )
      .all(bandId) as Array<{
      action: string;
      user_id: string | null;
      metadata: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('band.transfer_ownership');
    expect(rows[0].user_id).toBe(owner);
    expect(rows[0].metadata).toContain(member);
  });

  it('rejects transferring ownership to a non-member', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members/me`, {
        method: 'DELETE',
        headers: {
          cookie: cookieHeader(sid),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ transferTo: stranger }),
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('transfer_target_not_a_member');
    expect(dbMod.stmts.findMembership.get(bandId, owner)?.role).toBe('owner');
  });

  it('rejects transferring ownership to self', async () => {
    const owner = createUser('owner@example.com');
    const member = createUser('member@example.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, member);

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members/me`, {
        method: 'DELETE',
        headers: {
          cookie: cookieHeader(sid),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ transferTo: owner }),
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('cannot_transfer_to_self');
  });

  it('ignores transferTo on a non-owner leave', async () => {
    const owner = createUser('owner@example.com');
    const member = createUser('member@example.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, member);

    const sid = createSession(member);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members/me`, {
        method: 'DELETE',
        headers: {
          cookie: cookieHeader(sid),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ transferTo: owner }),
      }),
    );
    expect(res.status).toBe(200);
    // Non-owner leave doesn't touch ownership.
    expect(dbMod.stmts.findBandById.get(bandId)?.owner_user_id).toBe(owner);
    expect(dbMod.stmts.findMembership.get(bandId, owner)?.role).toBe('owner');
    expect(dbMod.stmts.findMembership.get(bandId, member)).toBeUndefined();
  });

  it('removes the membership for a non-owner member', async () => {
    const owner = createUser('owner@example.com');
    const member = createUser('member@example.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, member);

    const sid = createSession(member);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members/me`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);

    expect(dbMod.stmts.findMembership.get(bandId, member)).toBeUndefined();
    // Owner is untouched.
    expect(
      dbMod.stmts.findMembership.get(bandId, owner),
    ).not.toBeUndefined();
  });

  it('leaving twice in a row is idempotent (second call returns 404)', async () => {
    const owner = createUser('owner@example.com');
    const member = createUser('member@example.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, member);

    const sid = createSession(member);
    const first = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members/me`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(first.status).toBe(200);
    const second = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members/me`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(second.status).toBe(404);
  });
});

describe('DELETE /api/bands/:id', () => {
  it('requires authentication', async () => {
    const res = await app.fetch(
      new Request('http://x/api/bands/anything', { method: 'DELETE' }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members (does not leak existence)', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Secret Society', owner);

    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
    // Band is untouched.
    expect(dbMod.stmts.findBandById.get(bandId)).not.toBeUndefined();
  });

  it('returns 403 for non-owner members', async () => {
    const owner = createUser('owner@example.com');
    const member = createUser('member@example.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, member);

    const sid = createSession(member);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(403);
    expect(dbMod.stmts.findBandById.get(bandId)).not.toBeUndefined();
  });

  it('soft-deletes the band when the owner requests it', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);

    // The live-row query no longer sees it.
    expect(dbMod.stmts.findBandById.get(bandId)).toBeUndefined();
    // But the row still exists with deleted_at populated.
    const ghost = dbMod.stmts.findBandAnyState.get(bandId);
    expect(ghost).not.toBeUndefined();
    expect(ghost?.deleted_at).toBeGreaterThan(0);
    expect(ghost?.deleted_by).toBe(owner);
    expect(ghost?.deleted_reason).toBe('user');
  });

  it('soft-deleted band disappears from GET /api/bands and GET /api/bands/:id for everyone', async () => {
    const owner = createUser('owner@example.com');
    const member = createUser('member@example.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, member);

    const ownerSid = createSession(owner);
    const memberSid = createSession(member);

    const del = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(ownerSid) },
      }),
    );
    expect(del.status).toBe(200);

    for (const sid of [ownerSid, memberSid]) {
      const list = await app.fetch(
        new Request('http://x/api/bands', {
          headers: { cookie: cookieHeader(sid) },
        }),
      );
      expect(list.status).toBe(200);
      const body = (await list.json()) as { bands: unknown[] };
      expect(body.bands).toEqual([]);

      const get = await app.fetch(
        new Request(`http://x/api/bands/${bandId}`, {
          headers: { cookie: cookieHeader(sid) },
        }),
      );
      expect(get.status).toBe(404);
    }
  });

  it('records a band.soft_delete audit log entry', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);

    const rows = dbMod.db
      .prepare(
        `SELECT action, resource_type, resource_id, user_id, band_id, metadata
           FROM audit_log
          WHERE resource_type = 'band' AND resource_id = ?`,
      )
      .all(bandId) as Array<{
      action: string;
      resource_type: string;
      resource_id: string;
      user_id: string | null;
      band_id: string | null;
      metadata: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('band.soft_delete');
    expect(rows[0].user_id).toBe(owner);
    expect(rows[0].band_id).toBe(bandId);
    expect(rows[0].metadata).toContain('Alpha');
  });

  it('deleting twice in a row is idempotent (second call returns 404)', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);

    const sid = createSession(owner);
    const first = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(first.status).toBe(200);

    const second = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(second.status).toBe(404);
  });

  it('reusing the name of a soft-deleted band is blocked until purge', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);

    const sid = createSession(owner);
    const del = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(del.status).toBe(200);

    // The folder under PAPERSTEM_AUDIO_ROOT/Alpha still exists; allowing
    // a new band with the same name would let two band rows reference the
    // same audio folder, and the purge sweep would eventually trash the
    // live band's audio. So the name is reserved until purge.
    process.env.PAPERSTEM_AUDIO_ROOT = audioRoot;
    const create = await app.fetch(
      new Request('http://x/api/bands', {
        method: 'POST',
        headers: {
          cookie: cookieHeader(sid),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Alpha' }),
      }),
    );
    expect(create.status).toBe(409);
    const body = (await create.json()) as { error: string };
    expect(body.error).toBe('duplicate_name_pending_purge');
  });

  it('cascade soft-deletes live projects and revokes their public links', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);

    // Insert a project and a public link directly so we can verify the
    // cascade without needing the project/public-link handlers.
    const projectId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.insertProject.run(
      projectId,
      bandId,
      'Sample',
      null,
      'fld',
      null,
      now,
      owner,
      now,
    );
    const linkToken = 'tok-' + randomUUID();
    dbMod.stmts.insertPublicLink.run(linkToken, projectId, owner, now);

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);

    // Project is soft-deleted with the cascade reason.
    const project = dbMod.stmts.findProjectAnyState.get(projectId);
    expect(project?.deleted_at).toBeGreaterThan(0);
    expect(project?.deleted_by).toBe(owner);
    expect(project?.deleted_reason).toBe('band_deleted');

    // Public link is trash-revoked, so /p/<token> stops serving audio
    // immediately rather than 30 days later at purge.
    const link = dbMod.stmts.findPublicLinkByToken.get(linkToken);
    expect(link?.revoked_at).toBeGreaterThan(0);
    expect(link?.revoked_reason).toBe('trash');

    // Cascade counts are recorded in the audit metadata.
    const rows = dbMod.db
      .prepare(
        `SELECT metadata FROM audit_log
          WHERE resource_type = 'band' AND resource_id = ? AND action = 'band.soft_delete'`,
      )
      .all(bandId) as Array<{ metadata: string | null }>;
    expect(rows).toHaveLength(1);
    const meta = JSON.parse(rows[0].metadata ?? '{}') as {
      projects_soft_deleted: number;
      public_links_revoked: number;
    };
    expect(meta.projects_soft_deleted).toBe(1);
    expect(meta.public_links_revoked).toBe(1);
  });
});

describe('GET /api/bands purge sweep', () => {
  it('purges bands soft-deleted >30 days ago, trashes their audio, and logs band.purge with the triggering user', async () => {
    const { mkdirSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');

    const owner = createUser('owner@example.com');
    const lister = createUser('lister@example.com');
    const bandId = createBand('Alpha', owner, 'QWxwaGE'); // base64url('Alpha')

    // Mint a real audio folder on disk so we can assert it gets trashed.
    const liveFolder = join(audioRoot, 'Alpha');
    mkdirSync(liveFolder, { recursive: true });

    // Soft-delete via the route, then back-date the deleted_at past the cutoff.
    const ownerSid = createSession(owner);
    const del = await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(ownerSid) },
      }),
    );
    expect(del.status).toBe(200);
    const longAgo = Math.floor(Date.now() / 1000) - (31 * 24 * 60 * 60);
    dbMod.db
      .prepare('UPDATE bands SET deleted_at = ? WHERE id = ?')
      .run(longAgo, bandId);

    // A *different* user lists bands — the sweep should still fire and the
    // audit row should attribute the trigger to the lister, not the deleter.
    const listerSid = createSession(lister);
    const list = await app.fetch(
      new Request('http://x/api/bands', {
        headers: { cookie: cookieHeader(listerSid) },
      }),
    );
    expect(list.status).toBe(200);

    // Band row is gone (CASCADE wiped any children).
    expect(dbMod.stmts.findBandAnyState.get(bandId)).toBeUndefined();

    // Audio folder was moved to _trash.
    expect(existsSync(liveFolder)).toBe(false);
    expect(existsSync(join(audioRoot, '_trash', 'QWxwaGE'))).toBe(true);

    // Audit row records the system actor + the triggering user.
    const rows = dbMod.db
      .prepare(
        `SELECT action, user_id, metadata FROM audit_log
          WHERE resource_type = 'band' AND resource_id = ? AND action = 'band.purge'`,
      )
      .all(bandId) as Array<{
      action: string;
      user_id: string | null;
      metadata: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBeNull();
    const meta = JSON.parse(rows[0].metadata ?? '{}') as {
      name: string;
      triggered_by_user_id: string;
      triggered_by_user_email: string | null;
    };
    expect(meta.name).toBe('Alpha');
    expect(meta.triggered_by_user_id).toBe(lister);
    expect(meta.triggered_by_user_email).toBe('lister@example.com');
  });

  it('leaves bands within the 30-day window alone', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);

    const sid = createSession(owner);
    await app.fetch(
      new Request(`http://x/api/bands/${bandId}`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );

    // First listing right after delete: the band is soft-deleted but
    // within the retention window, so purge should NOT fire.
    await app.fetch(
      new Request('http://x/api/bands', {
        headers: { cookie: cookieHeader(sid) },
      }),
    );

    const ghost = dbMod.stmts.findBandAnyState.get(bandId);
    expect(ghost).not.toBeUndefined();
    expect(ghost?.deleted_at).toBeGreaterThan(0);
  });
});
