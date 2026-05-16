import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-presence-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.PAPERSTEM_AUDIO_ROOT = join(tmpDir, 'audio');
mkdirSync(process.env.PAPERSTEM_AUDIO_ROOT, { recursive: true });
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('./db.js');
type PresenceWsModule = typeof import('./presence-ws.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let port: number;

beforeAll(async () => {
  dbMod = await import('./db.js');
  const presenceWsMod: PresenceWsModule = await import('./presence-ws.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');

  const { Hono } = await import('hono');
  const { serve } = await import('@hono/node-server');
  const app = new Hono<{ Variables: typeof middlewareMod.sessionMiddleware extends (...args: any[]) => any ? any : never }>();
  app.use('*', middlewareMod.sessionMiddleware);
  const { injectWebSocket } = presenceWsMod.registerPresenceWs(app as any);
  await new Promise<void>((res) => {
    const srv = serve({ fetch: app.fetch as any, port: 0 }, (info) => {
      port = info.port;
      injectWebSocket(srv as any);
      res();
    });
  });
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function seedUserAndSession(name: string): { userId: string; cookieHeader: string } {
  const userId = randomUUID();
  const sessionId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertUser.run(userId, `${name}@example.com`, name, now);
  dbMod.stmts.insertSession.run(sessionId, userId, now + 3600, now);
  return { userId, cookieHeader: `${cookieMod.SESSION_COOKIE_NAME}=${sessionId}` };
}

function seedBandWithProject(userIds: string[]): { bandId: string; projectId: string } {
  const bandId = randomUUID();
  const projectId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const folderName = `band-${bandId}`;
  const firstUserId = userIds[0]!;
  dbMod.stmts.insertBand.run(bandId, 'Band', folderName, firstUserId, now);
  for (const uid of userIds) {
    const role = uid === firstUserId ? 'owner' : 'member';
    dbMod.stmts.insertMembership.run(bandId, uid, role, now);
  }
  dbMod.stmts.insertProject.run(
    projectId, bandId, 'Project', null, `${folderName}/project-${projectId}`, null, now, firstUserId, now,
  );
  return { bandId, projectId };
}

function openWs(cookieHeader: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${port}/ws/presence`, {
    headers: { cookie: cookieHeader },
  });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

function closeWs(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.once('close', () => resolve());
    ws.close();
  });
}

beforeEach(() => {
  dbMod.db.exec(
    'DELETE FROM memberships; DELETE FROM projects; DELETE FROM bands; DELETE FROM sessions; DELETE FROM users;',
  );
});

describe('/ws/presence', () => {
  it('broadcasts presence between two members of the same project', async () => {
    const alice = seedUserAndSession('alice');
    const bob = seedUserAndSession('bob');
    const { projectId } = seedBandWithProject([alice.userId, bob.userId]);

    const wsA = await openWs(alice.cookieHeader);
    const wsB = await openWs(bob.cookieHeader);

    wsA.send(JSON.stringify({ type: 'subscribe', projectIds: [projectId] }));
    wsB.send(JSON.stringify({ type: 'subscribe', projectIds: [projectId] }));
    // Initial snapshots arrive on each socket.
    await nextMessage(wsA);
    await nextMessage(wsB);

    wsA.send(JSON.stringify({ type: 'beat', projectId, state: 'active' }));
    const onB = await nextMessage(wsB);
    expect(onB.type).toBe('presence');
    expect(onB.projectId).toBe(projectId);
    expect(onB.rows.map((r: any) => r.displayName)).toContain('alice');

    // Close Alice; Bob should receive an updated snapshot with Alice gone.
    wsA.close();
    const removal = await nextMessage(wsB);
    expect(removal.rows.find((r: any) => r.displayName === 'alice')).toBeUndefined();

    await closeWs(wsB);
  });

  it('silently drops subscriptions to unauthorized projects', async () => {
    const alice = seedUserAndSession('alice');
    const eve = seedUserAndSession('eve');
    const { projectId } = seedBandWithProject([alice.userId]);
    // Eve is NOT a member.

    const wsE = await openWs(eve.cookieHeader);
    wsE.send(JSON.stringify({ type: 'subscribe', projectIds: [projectId] }));
    wsE.send(JSON.stringify({ type: 'beat', projectId, state: 'active' }));

    // Brief pause to let Eve's beat process before Alice subscribes.
    await new Promise((r) => setTimeout(r, 50));

    // Alice subscribes; she should NOT see Eve.
    const wsA = await openWs(alice.cookieHeader);
    wsA.send(JSON.stringify({ type: 'subscribe', projectIds: [projectId] }));
    const snap = await nextMessage(wsA);
    expect(snap.rows).toHaveLength(0);
    expect(snap.anonymousCount).toBe(0);

    await closeWs(wsE);
    await closeWs(wsA);
  });
});
