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
    'DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
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

  it('returns 409 when the caller is the band owner', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request(`http://x/api/bands/${bandId}/members/me`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('owner_cannot_leave');

    // Owner is still in the band.
    expect(
      dbMod.stmts.findMembership.get(bandId, owner),
    ).not.toBeUndefined();
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
