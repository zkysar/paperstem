import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-health-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('./db.js');
type HealthModule = typeof import('./health.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let healthMod: HealthModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  healthMod = await import('./health.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.get('/api/health/snapshots', healthMod.handleSnapshotsHealth);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  dbMod.db.exec(
    'DELETE FROM annotations; DELETE FROM stems; DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
}

function createUser(email: string): string {
  const id = randomUUID();
  dbMod.stmts.insertUser.run(id, email, null, Math.floor(Date.now() / 1000));
  return id;
}

function createBand(
  name: string,
  ownerId: string,
  opts: { lastSnapshotAt?: number | null; lastBackupAt?: number | null } = {},
): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertBand.run(id, name, 'drive-x', ownerId, now);
  dbMod.stmts.insertMembership.run(id, ownerId, 'owner', now);
  if (opts.lastSnapshotAt !== undefined) {
    dbMod.stmts.setBandLastSnapshotAt.run(opts.lastSnapshotAt!, id);
  }
  if (opts.lastBackupAt !== undefined) {
    dbMod.stmts.setBandLastBackupAt.run(opts.lastBackupAt!, id);
  }
  return id;
}

function addMember(bandId: string, userId: string, role: 'owner' | 'member') {
  dbMod.stmts.insertMembership.run(
    bandId,
    userId,
    role,
    Math.floor(Date.now() / 1000),
  );
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

beforeEach(() => {
  reset();
});

describe('GET /api/health/snapshots', () => {
  it('requires authentication', async () => {
    const res = await app.fetch(new Request('http://x/api/health/snapshots'));
    expect(res.status).toBe(401);
  });

  it('returns 403 when user has no owner role anywhere', async () => {
    const owner = createUser('o@x.com');
    const memberOnly = createUser('m@x.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, memberOnly, 'member');

    const sid = createSession(memberOnly);
    const res = await app.fetch(
      new Request('http://x/api/health/snapshots', {
        headers: { cookie: cookie(sid) },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns owned bands with freshness flags', async () => {
    const owner = createUser('o@x.com');
    const now = Math.floor(Date.now() / 1000);
    const fresh = createBand('Fresh', owner, {
      lastSnapshotAt: now - 60,
      lastBackupAt: now - 60,
    });
    const stale = createBand('Stale', owner, {
      lastSnapshotAt: now - 48 * 60 * 60,
      lastBackupAt: now - 30 * 24 * 60 * 60,
    });
    const never = createBand('Never', owner);

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request('http://x/api/health/snapshots', {
        headers: { cookie: cookie(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      now: number;
      bands: {
        id: string;
        name: string;
        last_snapshot_at: number | null;
        last_backup_at: number | null;
        snapshot_age_seconds: number | null;
        backup_age_seconds: number | null;
        snapshot_stale: boolean;
        backup_stale: boolean;
      }[];
    };
    expect(typeof body.now).toBe('number');
    expect(body.bands).toHaveLength(3);
    const byId = new Map(body.bands.map((b) => [b.id, b]));
    const f = byId.get(fresh)!;
    expect(f.snapshot_stale).toBe(false);
    expect(f.backup_stale).toBe(false);
    expect(f.snapshot_age_seconds).toBeGreaterThanOrEqual(60);
    const s = byId.get(stale)!;
    expect(s.snapshot_stale).toBe(true);
    expect(s.backup_stale).toBe(true);
    const n = byId.get(never)!;
    expect(n.last_snapshot_at).toBeNull();
    expect(n.last_backup_at).toBeNull();
    expect(n.snapshot_age_seconds).toBeNull();
    expect(n.backup_age_seconds).toBeNull();
    expect(n.snapshot_stale).toBe(true);
    expect(n.backup_stale).toBe(true);
  });

  it('only returns bands the user owns', async () => {
    const ownerA = createUser('a@x.com');
    const ownerB = createUser('b@x.com');
    const bandA = createBand('A', ownerA);
    const bandB = createBand('B', ownerB);
    addMember(bandB, ownerA, 'member');

    const sid = createSession(ownerA);
    const res = await app.fetch(
      new Request('http://x/api/health/snapshots', {
        headers: { cookie: cookie(sid) },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bands: { id: string }[] };
    expect(body.bands.map((b) => b.id)).toEqual([bandA]);
    expect(bandB).not.toBe(bandA);
  });
});
