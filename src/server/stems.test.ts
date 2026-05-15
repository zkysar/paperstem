import { Buffer } from 'node:buffer';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-stems-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
const audioRoot = join(tmpDir, 'audio');
mkdirSync(audioRoot, { recursive: true });
process.env.DATABASE_PATH = dbPath;
process.env.PAPERSTEM_AUDIO_ROOT = audioRoot;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('./db.js');
type StemsModule = typeof import('./stems.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let stemsMod: StemsModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  stemsMod = await import('./stems.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.patch('/api/stems/:id', stemsMod.handleRenameStem);
  app.delete('/api/stems/:id', stemsMod.handleDeleteStem);
  app.post('/api/stems/:id/restore', stemsMod.handleRestoreStem);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  dbMod.db.exec(
    'DELETE FROM stems; DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
  rmSync(audioRoot, { recursive: true, force: true });
  mkdirSync(audioRoot, { recursive: true });
}

function encodeId(rel: string): string {
  return Buffer.from(rel, 'utf8').toString('base64url');
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

function createProjectAndStem(
  bandFolderName: string,
  bandId: string,
  ownerId: string,
  stemName: string,
): { projectId: string; stemId: string; fileId: string; rel: string } {
  const projectFolderRel = `${bandFolderName}/p1`;
  const stemRel = `${projectFolderRel}/${stemName}`;
  // Create files on disk so the storage layer can act on them.
  mkdirSync(join(audioRoot, projectFolderRel), { recursive: true });
  writeFileSync(join(audioRoot, stemRel), 'audio-bytes');
  const projectId = randomUUID();
  const stemId = randomUUID();
  const fileId = encodeId(stemRel);
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertProject.run(
    projectId,
    bandId,
    'p1',
    '2026-05-01',
    encodeId(projectFolderRel),
    null,
    now,
    ownerId,
    now,
  );
  dbMod.stmts.insertStem.run(stemId, projectId, stemName, 0, fileId, null, 1024, null);
  return { projectId, stemId, fileId, rel: stemRel };
}

beforeEach(() => {
  reset();
});

describe('PATCH /api/stems/:id', () => {
  it('renames stem on disk and in DB', async () => {
    const owner = createUser('owner@example.com');
    const bandName = 'Alpha';
    const bandId = createBand(bandName, owner);
    const { stemId, rel } = createProjectAndStem(bandName, bandId, owner, 'old.wav');
    const sid = createSession(owner);

    const res = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}`, {
        method: 'PATCH',
        headers: {
          Cookie: cookieHeader(sid),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'new.wav' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; name: string };
    expect(body).toMatchObject({ ok: true, name: 'new.wav' });

    expect(existsSync(join(audioRoot, rel))).toBe(false);
    expect(existsSync(join(audioRoot, bandName, 'p1', 'new.wav'))).toBe(true);

    const row = dbMod.stmts.findStemById.get(stemId)!;
    expect(row.name).toBe('new.wav');
    expect(row.file_id).toBe(encodeId(`${bandName}/p1/new.wav`));
  });

  it('returns 200 even if filesystem rename fails (DB still updates)', async () => {
    const owner = createUser('owner@example.com');
    const bandName = 'Alpha';
    const bandId = createBand(bandName, owner);
    const { stemId } = createProjectAndStem(bandName, bandId, owner, 'old.wav');
    // Remove the file so rename fails with ENOENT.
    rmSync(join(audioRoot, bandName, 'p1', 'old.wav'));
    const sid = createSession(owner);

    const res = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}`, {
        method: 'PATCH',
        headers: {
          Cookie: cookieHeader(sid),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'renamed.wav' }),
      }),
    );
    expect(res.status).toBe(200);

    const row = dbMod.stmts.findStemById.get(stemId)!;
    expect(row.name).toBe('renamed.wav');
    // file_id must NOT be updated when the disk rename fails: it still points
    // at the original on-disk location (which is also gone in this test). The
    // important property is that we never advance the pointer to a path that
    // does not exist on disk, since that would make the audio handler ghost
    // the row on next fetch.
    expect(row.file_id).toBe(encodeId(`${bandName}/p1/old.wav`));
  });

  it('rejects empty or oversized names with 400', async () => {
    const owner = createUser('owner@example.com');
    const bandName = 'Alpha';
    const bandId = createBand(bandName, owner);
    const { stemId } = createProjectAndStem(bandName, bandId, owner, 'original.wav');
    const sid = createSession(owner);

    const emptyRes = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}`, {
        method: 'PATCH',
        headers: {
          Cookie: cookieHeader(sid),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: '' }),
      }),
    );
    expect(emptyRes.status).toBe(400);

    const bigRes = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}`, {
        method: 'PATCH',
        headers: {
          Cookie: cookieHeader(sid),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'x'.repeat(201) }),
      }),
    );
    expect(bigRes.status).toBe(400);

    const row = dbMod.stmts.findStemById.get(stemId)!;
    expect(row.name).toBe('original.wav');
    expect(existsSync(join(audioRoot, bandName, 'p1', 'original.wav'))).toBe(true);
  });

  it('rejects non-members with 404', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandName = 'Alpha';
    const bandId = createBand(bandName, owner);
    const { stemId } = createProjectAndStem(bandName, bandId, owner, 'original.wav');
    const sid = createSession(stranger);

    const res = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}`, {
        method: 'PATCH',
        headers: {
          Cookie: cookieHeader(sid),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'new.wav' }),
      }),
    );
    expect(res.status).toBe(404);

    const row = dbMod.stmts.findStemById.get(stemId)!;
    expect(row.name).toBe('original.wav');
    expect(existsSync(join(audioRoot, bandName, 'p1', 'original.wav'))).toBe(true);
  });
});

describe('DELETE /api/stems/:id', () => {
  it('soft-deletes the stem and removes the file from disk', async () => {
    const owner = createUser('owner@example.com');
    const bandName = 'Alpha';
    const bandId = createBand(bandName, owner);
    const { stemId, rel } = createProjectAndStem(bandName, bandId, owner, 'drums.wav');
    const sid = createSession(owner);

    const res = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);

    expect(existsSync(join(audioRoot, rel))).toBe(false);

    expect(dbMod.stmts.findStemById.get(stemId)).toBeUndefined();
    const row = dbMod.stmts.findStemAnyState.get(stemId)!;
    expect(row.deleted_at).toBeGreaterThan(0);
    expect(row.deleted_by).toBe(owner);
    expect(row.deleted_reason).toBe('user');
  });

  it('rejects non-members with 404', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandName = 'Alpha';
    const bandId = createBand(bandName, owner);
    const { stemId, rel } = createProjectAndStem(bandName, bandId, owner, 'drums.wav');
    const sid = createSession(stranger);

    const res = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);

    const row = dbMod.stmts.findStemAnyState.get(stemId)!;
    expect(row.deleted_at).toBeNull();
    expect(existsSync(join(audioRoot, rel))).toBe(true);
  });
});

describe('POST /api/stems/:id/restore', () => {
  it('restores soft-deleted stem (untrash is a no-op on local storage)', async () => {
    const owner = createUser('owner@example.com');
    const bandName = 'Alpha';
    const bandId = createBand(bandName, owner);
    const { stemId } = createProjectAndStem(bandName, bandId, owner, 'drums.wav');
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.softDeleteStem.run(now, owner, stemId);
    const sid = createSession(owner);

    const res = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}/restore`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(200);

    const row = dbMod.stmts.findStemById.get(stemId)!;
    expect(row).toBeDefined();
    expect(row.deleted_at).toBeNull();
  });

  it('returns 409 for ghost rows (drive_missing)', async () => {
    const owner = createUser('owner@example.com');
    const bandName = 'Alpha';
    const bandId = createBand(bandName, owner);
    const { stemId } = createProjectAndStem(bandName, bandId, owner, 'drums.wav');
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.markStemGhost.run(now, stemId);
    const sid = createSession(owner);

    const res = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}/restore`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(409);

    const row = dbMod.stmts.findStemAnyState.get(stemId)!;
    expect(row.deleted_reason).toBe('drive_missing');
  });

  it('rejects non-members with 404', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandName = 'Alpha';
    const bandId = createBand(bandName, owner);
    const { stemId } = createProjectAndStem(bandName, bandId, owner, 'drums.wav');
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.softDeleteStem.run(now, owner, stemId);
    const sid = createSession(stranger);

    const res = await app.fetch(
      new Request(`http://localhost/api/stems/${stemId}/restore`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(sid) },
      }),
    );
    expect(res.status).toBe(404);
  });
});
