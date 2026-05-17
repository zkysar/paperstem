import type { Hono, MiddlewareHandler } from 'hono';
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

// Reject the upgrade with a real HTTP status before @hono/node-ws takes over.
// Returning a Response from middleware stops the chain, so the WS client sees
// a clean 401 instead of the 500 you'd get from throwing inside the upgrade
// handler.
const requirePresenceAuth: MiddlewareHandler<{ Variables: AuthVariables }> =
  async (c, next) => {
    const user = c.get('user');
    const linkToken = c.req.query('link') ?? null;
    if (!user && !linkToken) {
      return c.text('unauthenticated', 401);
    }
    if (!user) {
      const row = stmts.findPublicLinkByToken.get(linkToken!) as
        | { revoked_at: number | null }
        | undefined;
      if (!row || row.revoked_at) {
        return c.text('invalid link', 401);
      }
    }
    return next();
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
    requirePresenceAuth,
    upgradeWebSocket((c) => {
      // Auth is already validated by requirePresenceAuth — middleware would
      // have returned 401 before this handler ran.
      const user = c.get('user');
      const linkToken = c.req.query('link') ?? null;

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
        onMessage(evt, ws) {
          let msg: unknown;
          try {
            msg = JSON.parse(typeof evt.data === 'string' ? evt.data : '');
          } catch {
            return;
          }
          if (!msg || typeof msg !== 'object') return;
          const m = msg as Record<string, unknown>;

          if (m.type === 'subscribe') {
            const requested = Array.isArray(m.projectIds)
              ? m.projectIds.filter((x): x is string => typeof x === 'string')
              : [];
            const allowed = new Set<string>();
            for (const projectId of requested) {
              if (canAccessProject(projectId, { userId: ctx.userId, linkToken })) {
                allowed.add(projectId);
              }
            }
            const removed: string[] = [];
            for (const old of ctx.subscribed) {
              if (!allowed.has(old)) {
                const affected = registry.removeConnFromProject(ctx.connId, old);
                if (affected.length) removed.push(old);
              }
            }
            ctx.subscribed = allowed;
            for (const p of removed) broadcast(p);
            for (const projectId of allowed) {
              ws.send(JSON.stringify(snapshotFor(projectId, ctx.isAnonymous)));
            }
            return;
          }

          if (m.type === 'beat') {
            const projectId = typeof m.projectId === 'string' ? m.projectId : null;
            const state = m.state === 'idle' ? 'idle' : 'active';
            if (!projectId || !ctx.subscribed.has(projectId)) return;
            registry.addOrUpdate(ctx.connId, projectId, {
              userId: ctx.userId,
              displayName: ctx.displayName,
              state,
              isAnonymous: ctx.isAnonymous,
            });
            broadcast(projectId);
            return;
          }
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
