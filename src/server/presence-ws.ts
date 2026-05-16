import type { Hono } from 'hono';
import { createNodeWebSocket } from '@hono/node-ws';
import { stmts } from './db.js';
import type { AuthVariables } from './auth/middleware.js';
import { createRegistry, type Registry } from './presence.js';

// Project access check. Members: must have a membership row to the project's
// band. Anonymous: token must be a valid, non-revoked public_link granting
// access to that specific project. Returns true iff allowed.
function canAccessProject(
  projectId: string,
  ctx: { userId: string | null; linkToken: string | null },
): boolean {
  if (ctx.userId) {
    const row = stmts.findProjectMembership.get(projectId, ctx.userId) as
      | { band_id: string }
      | undefined;
    return !!row;
  }
  if (ctx.linkToken) {
    const row = stmts.findPublicLinkByToken.get(ctx.linkToken) as
      | { project_id: string; revoked_at: number | null }
      | undefined;
    return !!row && !row.revoked_at && row.project_id === projectId;
  }
  return false;
}

type ConnCtx = {
  connId: string;
  userId: string | null;
  displayName: string;
  isAnonymous: boolean;
  subscribed: Set<string>;
};

export function registerPresenceWs(app: Hono<{ Variables: AuthVariables }>) {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  const registry: Registry = createRegistry();
  // connId -> WebSocket; maintained outside the registry so we can broadcast.
  const conns = new Map<string, { ws: any; ctx: ConnCtx }>();

  function snapshotFor(projectId: string, anonymous: boolean) {
    const snap = registry.snapshot(projectId);
    if (anonymous) return { type: 'presence', projectId, rows: [], anonymousCount: snap.anonymousCount };
    return { type: 'presence', projectId, rows: snap.rows.map(stripInternal), anonymousCount: snap.anonymousCount };
  }

  function stripInternal(row: { connId: string; userId: string | null; displayName: string; state: 'active' | 'idle'; lastBeatAt: number }) {
    // connId is server-internal; do not leak it to clients.
    return {
      userId: row.userId,
      displayName: row.displayName,
      state: row.state,
      lastBeatAt: row.lastBeatAt,
    };
  }

  function broadcast(projectId: string) {
    for (const { ws, ctx } of conns.values()) {
      if (!ctx.subscribed.has(projectId)) continue;
      ws.send(JSON.stringify(snapshotFor(projectId, ctx.isAnonymous)));
    }
  }

  // Sweep every 10s; broadcast each affected project once.
  const sweepHandle = setInterval(() => {
    const affected = registry.sweep(30_000);
    for (const p of affected) broadcast(p);
  }, 10_000);
  // Don't keep the process alive for the sweeper alone.
  sweepHandle.unref?.();

  app.get(
    '/ws/presence',
    upgradeWebSocket((c) => {
      const user = c.get('user');
      const linkToken = c.req.query('link') ?? null;
      // Anonymous viewers must present a token; without either we reject.
      if (!user && !linkToken) {
        // upgradeWebSocket has no clean reject path; throwing causes 500 +
        // refusal of upgrade, which is fine for an unauthenticated client.
        throw new Error('unauthenticated');
      }
      // For anonymous, verify the token resolves before accepting the upgrade.
      if (!user) {
        const row = stmts.findPublicLinkByToken.get(linkToken!) as
          | { revoked_at: number | null }
          | undefined;
        if (!row || row.revoked_at) throw new Error('invalid link');
      }

      const ctx: ConnCtx = {
        connId: crypto.randomUUID(),
        userId: user?.id ?? null,
        displayName: user?.display_name ?? '',
        isAnonymous: !user,
        subscribed: new Set(),
      };

      return {
        onOpen(_evt, ws) {
          conns.set(ctx.connId, { ws, ctx });
        },
        onMessage() {
          // Subscribe + beat land in Task 5. Reference vars to satisfy lint:
          void registry; void canAccessProject; void linkToken; void snapshotFor; void broadcast;
        },
        onClose() {
          conns.delete(ctx.connId);
          const affected = registry.removeConn(ctx.connId);
          for (const p of affected) broadcast(p);
        },
      };
    }),
  );

  return { injectWebSocket };
}
