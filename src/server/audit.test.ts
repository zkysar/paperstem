import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-audit-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
const audioRoot = join(tmpDir, 'audio');
mkdirSync(audioRoot, { recursive: true });
process.env.DATABASE_PATH = dbPath;
process.env.PAPERSTEM_AUDIO_ROOT = audioRoot;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('./db.js');
type AuditModule = typeof import('./audit.js');
type ProjectsModule = typeof import('./projects.js');
type StemsModule = typeof import('./stems.js');
type AnnotationsModule = typeof import('./annotations.js');
type TrashModule = typeof import('./trash.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let auditMod: AuditModule;
let projectsMod: ProjectsModule;
let stemsMod: StemsModule;
let annotationsMod: AnnotationsModule;
let trashMod: TrashModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

type AuditRow = {
  id: string;
  created_at: number;
  user_id: string | null;
  user_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  band_id: string | null;
  metadata: string | null;
};

beforeAll(async () => {
  dbMod = await import('./db.js');
  auditMod = await import('./audit.js');
  projectsMod = await import('./projects.js');
  stemsMod = await import('./stems.js');
  annotationsMod = await import('./annotations.js');
  trashMod = await import('./trash.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.delete('/api/projects/:id', projectsMod.handleDeleteProject);
  app.delete('/api/stems/:id', stemsMod.handleDeleteStem);
  app.delete('/api/annotations/:id', annotationsMod.handleDeleteAnnotation);
  app.get('/api/bands/:id/trash', trashMod.handleListTrash);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  dbMod.db.exec(
    'DELETE FROM audit_log; DELETE FROM annotations; DELETE FROM stems; DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
  rmSync(audioRoot, { recursive: true, force: true });
  mkdirSync(audioRoot, { recursive: true });
  vi.restoreAllMocks();
}

beforeEach(() => {
  reset();
});

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

function insertProject(
  bandId: string,
  bandName: string,
  ownerId: string,
  name: string,
): { id: string; folderId: string } {
  const id = randomUUID();
  const folderRel = `${bandName}/${name}`;
  const folderId = encodeId(folderRel);
  mkdirSync(join(audioRoot, folderRel), { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertProject.run(id, bandId, name, null, folderId, null, now, ownerId, now);
  return { id, folderId };
}

function insertStem(projectId: string, name: string, position: number): { id: string; fileId: string } {
  const id = randomUUID();
  const fileId = encodeId(`stem-${id}`);
  dbMod.stmts.insertStem.run(id, projectId, name, position, fileId, null, 1024, null);
  return { id, fileId };
}

function allAudit(): AuditRow[] {
  return dbMod.db
    .prepare('SELECT * FROM audit_log ORDER BY created_at ASC, action ASC')
    .all() as AuditRow[];
}

describe('recordAudit (unit)', () => {
  it('inserts a row and emits a JSON line to stdout', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    auditMod.recordAudit({
      action: 'project.soft_delete',
      resource_type: 'project',
      resource_id: 'proj-xyz',
      actor: { id: 'user-1', email: 'a@b.com' },
      band_id: 'band-1',
      metadata: { name: 'test', extra: 42 },
    });

    const rows = allAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'project.soft_delete',
      resource_type: 'project',
      resource_id: 'proj-xyz',
      user_id: 'user-1',
      user_email: 'a@b.com',
      band_id: 'band-1',
    });
    expect(JSON.parse(rows[0].metadata ?? 'null')).toEqual({ name: 'test', extra: 42 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      type: 'audit',
      action: 'project.soft_delete',
      resource_id: 'proj-xyz',
      user_id: 'user-1',
    });
  });

  it('tolerates a null actor (system-initiated action)', () => {
    auditMod.recordAudit({
      action: 'stem.purge_cascade',
      resource_type: 'stem',
      resource_id: 's-1',
      actor: null,
      band_id: null,
    });
    const rows = allAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBeNull();
    expect(rows[0].user_email).toBeNull();
    expect(rows[0].metadata).toBeNull();
  });
});

describe('DELETE /api/projects/:id audit', () => {
  it('records project.soft_delete with the acting user', async () => {
    const userId = createUser('alice@example.com');
    const bandId = createBand('B', userId);
    const sessionId = createSession(userId);
    const { id: pid } = insertProject(bandId, 'B', userId, 'Project A');

    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${pid}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader(sessionId) },
      }),
    );
    expect(res.status).toBe(200);

    const rows = allAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'project.soft_delete',
      resource_type: 'project',
      resource_id: pid,
      user_id: userId,
      user_email: 'alice@example.com',
      band_id: bandId,
    });
    expect(JSON.parse(rows[0].metadata ?? 'null')).toMatchObject({ name: 'Project A' });
  });
});

describe('DELETE /api/stems/:id audit', () => {
  it('records stem.soft_delete with band_id resolved from the project', async () => {
    const userId = createUser('alice@example.com');
    const bandId = createBand('B', userId);
    const sessionId = createSession(userId);
    const { id: pid } = insertProject(bandId, 'B', userId, 'P');
    const { id: sid } = insertStem(pid, 'kick.wav', 0);

    const res = await app.fetch(
      new Request(`http://localhost/api/stems/${sid}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader(sessionId) },
      }),
    );
    expect(res.status).toBe(200);

    const rows = allAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'stem.soft_delete',
      resource_id: sid,
      user_id: userId,
      band_id: bandId,
    });
    expect(JSON.parse(rows[0].metadata ?? 'null')).toMatchObject({
      name: 'kick.wav',
      project_id: pid,
    });
  });
});

describe('DELETE /api/annotations/:id audit', () => {
  it('records annotation.hard_delete', async () => {
    const userId = createUser('alice@example.com');
    const bandId = createBand('B', userId);
    const sessionId = createSession(userId);
    const { id: pid } = insertProject(bandId, 'B', userId, 'P');

    const aid = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    dbMod.stmts.insertAnnotation.run(aid, pid, userId, 1000, 2000, 'note', 0, now, now);

    const res = await app.fetch(
      new Request(`http://localhost/api/annotations/${aid}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader(sessionId) },
      }),
    );
    expect(res.status).toBe(204);

    const rows = allAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'annotation.hard_delete',
      resource_id: aid,
      user_id: userId,
      band_id: bandId,
    });
  });
});

describe('trash purge audit (the cascade-gap case)', () => {
  it('records project.purge AND stem.purge_cascade for every stem the cascade wipes', async () => {
    const userId = createUser('alice@example.com');
    const bandId = createBand('B', userId);
    const sessionId = createSession(userId);
    const oldTs = Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60;

    // Old soft-deleted project with two live stems — cascade will wipe both
    // with no deleted_by, which is precisely the prod failure mode.
    const { id: pid } = insertProject(bandId, 'B', userId, 'OldProj');
    dbMod.stmts.softDeleteProject.run(oldTs, userId, pid);
    const { id: sid1 } = insertStem(pid, 'a.wav', 0);
    const { id: sid2 } = insertStem(pid, 'b.wav', 1);

    const res = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/trash`, {
        headers: { Cookie: cookieHeader(sessionId) },
      }),
    );
    expect(res.status).toBe(200);

    // The actual purge happened.
    expect(dbMod.stmts.findProjectAnyState.get(pid)).toBeUndefined();

    const rows = allAudit();
    const byAction = rows.reduce<Record<string, AuditRow[]>>((acc, r) => {
      (acc[r.action] ??= []).push(r);
      return acc;
    }, {});
    expect(byAction['project.purge']).toHaveLength(1);
    expect(byAction['project.purge'][0].resource_id).toBe(pid);
    expect(byAction['project.purge'][0].user_id).toBe(userId);

    expect(byAction['stem.purge_cascade']).toHaveLength(2);
    const cascadeIds = byAction['stem.purge_cascade'].map((r) => r.resource_id).sort();
    expect(cascadeIds).toEqual([sid1, sid2].sort());
    // Every cascade row attributes the action to whoever triggered the trash
    // listing (the actor we want to attribute this to), even though the
    // underlying SQL cascade has no concept of an actor.
    for (const r of byAction['stem.purge_cascade']) {
      expect(r.user_id).toBe(userId);
      expect(r.band_id).toBe(bandId);
    }
  });

  it('records stem.purge for stems whose project survives but the stem itself is old-trashed', async () => {
    const userId = createUser('alice@example.com');
    const bandId = createBand('B', userId);
    const sessionId = createSession(userId);
    const now = Math.floor(Date.now() / 1000);
    const oldTs = now - 31 * 24 * 60 * 60;

    // Live project, one stem soft-deleted 31d ago, one stem still live.
    const { id: pid } = insertProject(bandId, 'B', userId, 'LiveProj');
    const { id: oldStemId } = insertStem(pid, 'old.wav', 0);
    dbMod.stmts.softDeleteStem.run(oldTs, userId, oldStemId);
    insertStem(pid, 'live.wav', 1);

    const res = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/trash`, {
        headers: { Cookie: cookieHeader(sessionId) },
      }),
    );
    expect(res.status).toBe(200);

    const rows = allAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'stem.purge',
      resource_id: oldStemId,
      user_id: userId,
      band_id: bandId,
    });
  });

  it('writes nothing when there is nothing past the cutoff', async () => {
    const userId = createUser('alice@example.com');
    const bandId = createBand('B', userId);
    const sessionId = createSession(userId);
    const { id: pid } = insertProject(bandId, 'B', userId, 'Fresh');
    dbMod.stmts.softDeleteProject.run(Math.floor(Date.now() / 1000), userId, pid);

    const res = await app.fetch(
      new Request(`http://localhost/api/bands/${bandId}/trash`, {
        headers: { Cookie: cookieHeader(sessionId) },
      }),
    );
    expect(res.status).toBe(200);
    expect(allAudit()).toHaveLength(0);
  });
});
