# Project Presence Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google-Docs-style presence indicators showing who has each project open and whether they are active or idle. Visible in `ProjectPicker` rows and in `AppHeader` when a project is open.

**Architecture:** One WebSocket per tab over `/ws/presence`, mounted on the existing Hono server via `@hono/node-ws`. Server keeps an in-memory `Map<projectId, Map<connId, PresenceRow>>` with a 10s sweeper for stale rows. Client owns one singleton WS connection per tab; hooks (`usePresenceConnection`, `usePresence`) wrap subscriptions. Anonymous (public-link) viewers are counted but never named.

**Tech Stack:** Hono 4, `@hono/node-ws` (new dep), `ws` (transitive), React 19, vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-05-16-project-presence-design.md](../specs/2026-05-16-project-presence-design.md)

---

## File Structure

**Server**
- Create: `src/server/presence.ts` — registry data structure + sweeper. Pure logic, no Hono/WS coupling. Exports `createRegistry()`.
- Create: `src/server/presence-ws.ts` — Hono handler that wires the registry to `@hono/node-ws`, handles auth, subscribe, beat, broadcast, anonymous filtering.
- Create: `src/server/presence.test.ts` — registry unit tests.
- Create: `src/server/presence-ws.test.ts` — WS integration test (real `ws` client against an in-process server).
- Modify: `src/server/index.ts` — register `/ws/presence` route, capture `serve()` return value, call `injectWebSocket`.
- Modify: `package.json` — add `@hono/node-ws` dependency.

**Client**
- Create: `src/client/lib/presence-client.ts` — singleton WS owner. Pure module — no React. Exposes `subscribe(projectIds)`, `getSnapshot(projectId)`, `addListener(fn)`, plus internal active/idle detector.
- Create: `src/client/lib/presence-client.test.ts` — unit tests with mocked `WebSocket` and fake timers.
- Create: `src/client/hooks/usePresenceConnection.ts` — mounts the singleton, opens the socket, owns reconnect.
- Create: `src/client/hooks/usePresence.ts` — `usePresence(projectIds)` returning `Record<projectId, Snapshot>`.
- Create: `src/client/hooks/usePresence.test.ts` — hook tests.
- Create: `src/client/components/PresenceAvatars.tsx` — visual component.
- Create: `src/client/components/PresenceAvatars.test.tsx` — render tests.
- Modify: `src/client/styles/app.css` — `.presence-*` rules.
- Modify: `src/client/components/ProjectPicker.tsx` — render `<PresenceAvatars />` per row.
- Modify: `src/client/components/AppHeader.tsx` — render `<PresenceAvatars />` for current project.
- Modify: `src/client/App.tsx` — mount `usePresenceConnection()` once.

**E2E**
- Create: `tests/e2e/journeys/presence.spec.ts` — two browser contexts, asserts presence flow.

**Docs**
- Modify: `docs/testing.md` — append a "WebSocket route handlers" subsection citing `presence-ws.test.ts` as canonical.
- Modify: `CLAUDE.md` — add a one-line note about the presence WS endpoint to the Architecture paragraph.

---

## Task 1: Add `@hono/node-ws` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run:
```bash
npm install @hono/node-ws@^1.0.4
```

Expected: `package.json` and `package-lock.json` updated. The transitive `ws` dependency is installed.

- [ ] **Step 2: Verify it imports**

Run:
```bash
node -e "import('@hono/node-ws').then(m => console.log(Object.keys(m)))"
```

Expected: includes `createNodeWebSocket`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add @hono/node-ws for presence websocket"
```

---

## Task 2: Presence registry — types and `addOrUpdate`

**Files:**
- Create: `src/server/presence.ts`
- Create: `src/server/presence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/presence.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { createRegistry } from './presence.js';

describe('presence registry — addOrUpdate', () => {
  it('inserts a new row and returns the affected projects', () => {
    const reg = createRegistry({ now: () => 1000 });
    const affected = reg.addOrUpdate('conn-1', 'proj-A', {
      userId: 'u-1',
      displayName: 'Alice',
      state: 'active',
      isAnonymous: false,
    });
    expect(affected).toEqual(['proj-A']);
    const snap = reg.snapshot('proj-A');
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0]).toMatchObject({
      connId: 'conn-1',
      userId: 'u-1',
      displayName: 'Alice',
      state: 'active',
      lastBeatAt: 1000,
      isAnonymous: false,
    });
    expect(snap.anonymousCount).toBe(0);
  });

  it('updates an existing row in place and counts anonymous separately', () => {
    let t = 1000;
    const reg = createRegistry({ now: () => t });
    reg.addOrUpdate('conn-1', 'proj-A', {
      userId: 'u-1', displayName: 'Alice',
      state: 'active', isAnonymous: false,
    });
    t = 5000;
    reg.addOrUpdate('conn-1', 'proj-A', {
      userId: 'u-1', displayName: 'Alice',
      state: 'idle', isAnonymous: false,
    });
    reg.addOrUpdate('conn-2', 'proj-A', {
      userId: null, displayName: '',
      state: 'active', isAnonymous: true,
    });
    const snap = reg.snapshot('proj-A');
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0].state).toBe('idle');
    expect(snap.rows[0].lastBeatAt).toBe(5000);
    expect(snap.anonymousCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/presence.test.ts`
Expected: FAIL — "Cannot find module './presence.js'" or similar.

- [ ] **Step 3: Implement `createRegistry().addOrUpdate` and `snapshot`**

Create `src/server/presence.ts`:

```typescript
export type PresenceRow = {
  connId: string;
  userId: string | null;
  displayName: string;
  state: 'active' | 'idle';
  lastBeatAt: number;
  isAnonymous: boolean;
};

export type Snapshot = {
  rows: PresenceRow[];
  anonymousCount: number;
};

type Input = Omit<PresenceRow, 'connId' | 'lastBeatAt'>;

export type Registry = {
  addOrUpdate(connId: string, projectId: string, input: Input): string[];
  removeConn(connId: string): string[];
  sweep(maxAgeMs: number): string[];
  snapshot(projectId: string): Snapshot;
  subscribedProjects(): string[];
};

type Opts = { now?: () => number };

export function createRegistry(opts: Opts = {}): Registry {
  const now = opts.now ?? (() => Date.now());
  // projectId -> connId -> PresenceRow
  const byProject = new Map<string, Map<string, PresenceRow>>();

  function snapshot(projectId: string): Snapshot {
    const m = byProject.get(projectId);
    if (!m) return { rows: [], anonymousCount: 0 };
    const rows: PresenceRow[] = [];
    let anon = 0;
    for (const row of m.values()) {
      if (row.isAnonymous) anon++;
      else rows.push(row);
    }
    return { rows, anonymousCount: anon };
  }

  function addOrUpdate(connId: string, projectId: string, input: Input): string[] {
    let m = byProject.get(projectId);
    if (!m) {
      m = new Map();
      byProject.set(projectId, m);
    }
    m.set(connId, { ...input, connId, lastBeatAt: now() });
    return [projectId];
  }

  function removeConn(): string[] {
    return [];
  }
  function sweep(): string[] {
    return [];
  }
  function subscribedProjects(): string[] {
    return [...byProject.keys()];
  }

  return { addOrUpdate, removeConn, sweep, snapshot, subscribedProjects };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/presence.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/presence.ts src/server/presence.test.ts
git commit -m "feat(presence): registry addOrUpdate + snapshot"
```

---

## Task 3: Presence registry — `removeConn` and `sweep`

**Files:**
- Modify: `src/server/presence.ts`
- Modify: `src/server/presence.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/server/presence.test.ts`:

```typescript
describe('presence registry — removeConn', () => {
  it('removes rows for a conn across all projects and returns affected projects sorted', () => {
    const reg = createRegistry({ now: () => 1000 });
    reg.addOrUpdate('conn-1', 'proj-A', { userId: 'u-1', displayName: 'A', state: 'active', isAnonymous: false });
    reg.addOrUpdate('conn-1', 'proj-B', { userId: 'u-1', displayName: 'A', state: 'active', isAnonymous: false });
    reg.addOrUpdate('conn-2', 'proj-A', { userId: 'u-2', displayName: 'B', state: 'active', isAnonymous: false });
    const affected = reg.removeConn('conn-1');
    expect(affected.sort()).toEqual(['proj-A', 'proj-B']);
    expect(reg.snapshot('proj-A').rows).toHaveLength(1);
    expect(reg.snapshot('proj-B').rows).toHaveLength(0);
  });

  it('removes empty project maps so subscribedProjects shrinks', () => {
    const reg = createRegistry({ now: () => 1000 });
    reg.addOrUpdate('conn-1', 'proj-A', { userId: 'u-1', displayName: 'A', state: 'active', isAnonymous: false });
    reg.removeConn('conn-1');
    expect(reg.subscribedProjects()).toEqual([]);
  });
});

describe('presence registry — sweep', () => {
  it('drops rows older than maxAgeMs and returns affected projects', () => {
    let t = 1000;
    const reg = createRegistry({ now: () => t });
    reg.addOrUpdate('conn-1', 'proj-A', { userId: 'u-1', displayName: 'A', state: 'active', isAnonymous: false });
    reg.addOrUpdate('conn-2', 'proj-A', { userId: 'u-2', displayName: 'B', state: 'active', isAnonymous: false });
    t = 1000 + 35_000;
    reg.addOrUpdate('conn-2', 'proj-A', { userId: 'u-2', displayName: 'B', state: 'active', isAnonymous: false });
    // conn-1 hasn't beat in 35s; conn-2 just did.
    const affected = reg.sweep(30_000);
    expect(affected).toEqual(['proj-A']);
    expect(reg.snapshot('proj-A').rows.map((r) => r.connId)).toEqual(['conn-2']);
  });

  it('returns empty array when nothing was swept', () => {
    const reg = createRegistry({ now: () => 1000 });
    reg.addOrUpdate('conn-1', 'proj-A', { userId: 'u-1', displayName: 'A', state: 'active', isAnonymous: false });
    expect(reg.sweep(30_000)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/presence.test.ts`
Expected: FAIL — affected arrays empty.

- [ ] **Step 3: Implement `removeConn` and `sweep`**

Replace the `removeConn` and `sweep` stubs in `src/server/presence.ts` with:

```typescript
  function removeConn(connId: string): string[] {
    const affected: string[] = [];
    for (const [projectId, m] of byProject) {
      if (m.delete(connId)) {
        affected.push(projectId);
        if (m.size === 0) byProject.delete(projectId);
      }
    }
    return affected;
  }

  function sweep(maxAgeMs: number): string[] {
    const cutoff = now() - maxAgeMs;
    const affected = new Set<string>();
    for (const [projectId, m] of byProject) {
      for (const [connId, row] of m) {
        if (row.lastBeatAt < cutoff) {
          m.delete(connId);
          affected.add(projectId);
        }
      }
      if (m.size === 0) byProject.delete(projectId);
    }
    return [...affected];
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/presence.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/presence.ts src/server/presence.test.ts
git commit -m "feat(presence): registry removeConn + sweep"
```

---

## Task 4: Presence WS handler — scaffold + auth

**Files:**
- Create: `src/server/presence-ws.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add the handler module**

Create `src/server/presence-ws.ts`:

```typescript
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
      | { id: string }
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
          // Subscribe + beat land in Task 5.
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
```

- [ ] **Step 2: Add the required `stmts` entries**

Read `src/server/db.ts` to find where prepared statements are declared. Add (or confirm presence of):

```typescript
findProjectMembership: db.prepare<[string, string]>(
  'SELECT m.id FROM memberships m JOIN projects p ON p.band_id = m.band_id WHERE p.id = ? AND m.user_id = ?',
),
findPublicLinkByToken: db.prepare<[string]>(
  'SELECT project_id, revoked_at FROM public_links WHERE token = ?',
),
```

If a statement with the same purpose already exists (e.g. `getPublicLinkByToken` in `public-links.ts`), reuse it by re-exporting through `stmts` rather than duplicating. Verify by `grep -n "public_links" src/server/db.ts`.

- [ ] **Step 3: Wire into the server**

Modify `src/server/index.ts`. After the existing route registrations and before `serve(...)`, add:

```typescript
import { registerPresenceWs } from './presence-ws.js';

const { injectWebSocket } = registerPresenceWs(app);
```

Replace:

```typescript
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`paperstem server listening on http://localhost:${info.port}`);
});
```

with:

```typescript
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`paperstem server listening on http://localhost:${info.port}`);
});
injectWebSocket(server);
```

- [ ] **Step 4: Typecheck and start the server**

Run:
```bash
npx tsc --noEmit
```
Expected: PASS.

Run (in another shell, or backgrounded):
```bash
npm run dev:server
```
Expected: server starts without throwing at import. WS endpoint exists but no behavior yet.

- [ ] **Step 5: Commit**

```bash
git add src/server/presence-ws.ts src/server/index.ts src/server/db.ts
git commit -m "feat(presence): scaffold /ws/presence endpoint with auth"
```

---

## Task 5: Presence WS handler — subscribe + beat

**Files:**
- Modify: `src/server/presence-ws.ts`

- [ ] **Step 1: Implement message handling**

Replace the `onMessage()` stub in `src/server/presence-ws.ts` with:

```typescript
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
            // Drop subscriptions we used to have but no longer need; remove
            // our rows from them so other viewers see us leave.
            for (const old of ctx.subscribed) {
              if (!allowed.has(old)) {
                const affected = registry.removeConn(ctx.connId);
                for (const p of affected) broadcast(p);
              }
            }
            ctx.subscribed = allowed;
            // Send a snapshot for every subscription, so the client has
            // initial state even before any beat lands.
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server/presence-ws.ts
git commit -m "feat(presence): handle subscribe and beat over /ws/presence"
```

---

## Task 6: Server WS integration test

**Files:**
- Create: `src/server/presence-ws.test.ts`

- [ ] **Step 1: Write the integration test**

Create `src/server/presence-ws.test.ts`. Mirror the env prelude from `src/server/projects.test.ts` for DB setup, then drive the WS endpoint with the real `ws` client library (already a transitive dep).

```typescript
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
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
let presenceWsMod: PresenceWsModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let server: Server;
let port: number;

beforeAll(async () => {
  dbMod = await import('./db.js');
  presenceWsMod = await import('./presence-ws.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');

  const { Hono } = await import('hono');
  const { serve } = await import('@hono/node-server');
  const app = new Hono<{ Variables: middlewareMod.AuthVariables }>();
  app.use('*', middlewareMod.sessionMiddleware);
  const { injectWebSocket } = presenceWsMod.registerPresenceWs(app);
  server = serve({ fetch: app.fetch, port: 0 }) as unknown as Server;
  injectWebSocket(server as any);
  await new Promise<void>((res) => server.once('listening', () => res()));
  port = (server.address() as { port: number }).port;
});

afterAll(() => {
  server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function seedUserAndSession(name: string): { userId: string; cookieHeader: string } {
  const userId = randomUUID();
  const sessionId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.db.prepare(
    'INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)',
  ).run(userId, `${name}@example.com`, name, now);
  dbMod.db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?)',
  ).run(sessionId, userId, now, now + 3600, now);
  return { userId, cookieHeader: cookieMod.SESSION_COOKIE_NAME + '=' + sessionId };
}

function seedBandWithProject(userIds: string[]): { bandId: string; projectId: string } {
  const bandId = randomUUID();
  const projectId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.db.prepare(
    'INSERT INTO bands (id, name, created_at) VALUES (?, ?, ?)',
  ).run(bandId, 'Band', now);
  for (const uid of userIds) {
    dbMod.db.prepare(
      'INSERT INTO memberships (id, band_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(randomUUID(), bandId, uid, 'member', now);
  }
  dbMod.db.prepare(
    'INSERT INTO projects (id, band_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(projectId, bandId, 'Project', now, now);
  return { bandId, projectId };
}

function openWs(cookieHeader?: string, link?: string): Promise<WebSocket> {
  const qs = link ? `?link=${encodeURIComponent(link)}` : '';
  const ws = new WebSocket(`ws://localhost:${port}/ws/presence${qs}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
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

beforeEach(() => {
  // Truncate test data between tests.
  dbMod.db.exec('DELETE FROM memberships; DELETE FROM projects; DELETE FROM bands; DELETE FROM sessions; DELETE FROM users;');
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

    wsA.close();
    const removal = await nextMessage(wsB);
    expect(removal.rows.find((r: any) => r.displayName === 'alice')).toBeUndefined();
    wsB.close();
  });

  it('silently drops subscriptions to unauthorized projects', async () => {
    const alice = seedUserAndSession('alice');
    const eve = seedUserAndSession('eve');
    const { projectId } = seedBandWithProject([alice.userId]);
    // Eve is NOT a member.

    const wsE = await openWs(eve.cookieHeader);
    wsE.send(JSON.stringify({ type: 'subscribe', projectIds: [projectId] }));
    wsE.send(JSON.stringify({ type: 'beat', projectId, state: 'active' }));

    // Alice subscribes; she should NOT see Eve.
    const wsA = await openWs(alice.cookieHeader);
    wsA.send(JSON.stringify({ type: 'subscribe', projectIds: [projectId] }));
    const snap = await nextMessage(wsA);
    expect(snap.rows).toHaveLength(0);
    expect(snap.anonymousCount).toBe(0);

    wsE.close();
    wsA.close();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/server/presence-ws.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 3: If `findProjectMembership` / `findPublicLinkByToken` reuse needs adjustment**

If the test reveals missing prepared statements, add them to `src/server/db.ts` in the same pattern as adjacent statements, with the SQL shown in Task 4 Step 2. Re-run the test until it passes.

- [ ] **Step 4: Commit**

```bash
git add src/server/presence-ws.test.ts src/server/db.ts
git commit -m "test(presence): WS integration covers broadcast + auth filtering"
```

---

## Task 7: Client `presenceClient` — input state detector (no WS yet)

**Files:**
- Create: `src/client/lib/presence-client.ts`
- Create: `src/client/lib/presence-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/client/lib/presence-client.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPresenceClient } from './presence-client';

describe('presenceClient — input state detector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts active when document is visible and an input fires', () => {
    const c = createPresenceClient({ now: () => Date.now() });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('mousemove'));
    expect(c.computeState()).toBe('active');
  });

  it('flips to idle after 60s of no input', () => {
    const c = createPresenceClient({ now: () => Date.now() });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('mousemove'));
    expect(c.computeState()).toBe('active');
    vi.advanceTimersByTime(60_001);
    expect(c.computeState()).toBe('idle');
  });

  it('flips to idle when tab is hidden', () => {
    const c = createPresenceClient({ now: () => Date.now() });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('mousemove'));
    expect(c.computeState()).toBe('active');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(c.computeState()).toBe('idle');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/client/lib/presence-client.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the detector**

Create `src/client/lib/presence-client.ts`:

```typescript
type State = 'active' | 'idle';
type Opts = { now?: () => number };

export type PresenceClient = {
  computeState(): State;
  // The remaining members (subscribe/beat/etc.) are filled in by later tasks.
};

export function createPresenceClient(opts: Opts = {}): PresenceClient {
  const now = opts.now ?? (() => Date.now());
  let lastInputAt = now();
  const IDLE_MS = 60_000;

  const onInput = () => {
    lastInputAt = now();
  };
  window.addEventListener('focus', onInput);
  window.addEventListener('mousemove', onInput);
  window.addEventListener('keydown', onInput);
  window.addEventListener('pointerdown', onInput);
  document.addEventListener('mousemove', onInput);
  document.addEventListener('keydown', onInput);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') lastInputAt = now();
  });

  function computeState(): State {
    if (document.visibilityState !== 'visible') return 'idle';
    return now() - lastInputAt < IDLE_MS ? 'active' : 'idle';
  }

  return { computeState };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/client/lib/presence-client.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/presence-client.ts src/client/lib/presence-client.test.ts
git commit -m "feat(presence): client-side active/idle detector"
```

---

## Task 8: Client `presenceClient` — WS connection, subscribe set, beats, listeners

**Files:**
- Modify: `src/client/lib/presence-client.ts`
- Modify: `src/client/lib/presence-client.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/client/lib/presence-client.test.ts`:

```typescript
class MockSocket {
  static instances: MockSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    MockSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(payload: any) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe('presenceClient — WS lifecycle', () => {
  beforeEach(() => {
    MockSocket.instances.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T12:00:00Z'));
    (globalThis as any).WebSocket = MockSocket;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).WebSocket;
  });

  it('opens one socket and sends a subscribe with the union of requested project ids', () => {
    const c = createPresenceClient({ now: () => Date.now(), url: 'ws://test/ws/presence' });
    c.connect();
    const sock = MockSocket.instances[0];
    sock.open();
    c.subscribe('comp-A', ['p1', 'p2']);
    c.subscribe('comp-B', ['p2', 'p3']);
    const lastSubscribe = sock.sent
      .map((s) => JSON.parse(s))
      .filter((m) => m.type === 'subscribe')
      .pop();
    expect(lastSubscribe.projectIds.sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('emits snapshots to listeners when a presence message arrives', () => {
    const c = createPresenceClient({ now: () => Date.now(), url: 'ws://test/ws/presence' });
    c.connect();
    MockSocket.instances[0].open();
    c.subscribe('comp', ['p1']);
    const seen: any[] = [];
    c.addListener((proj, snap) => seen.push({ proj, snap }));
    MockSocket.instances[0].receive({
      type: 'presence', projectId: 'p1',
      rows: [{ userId: 'u1', displayName: 'Alice', state: 'active', lastBeatAt: 1000 }],
      anonymousCount: 0,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].proj).toBe('p1');
    expect(seen[0].snap.rows[0].displayName).toBe('Alice');
  });

  it('beats every 10s for every subscribed project', () => {
    const c = createPresenceClient({ now: () => Date.now(), url: 'ws://test/ws/presence' });
    c.connect();
    MockSocket.instances[0].open();
    c.subscribe('comp', ['p1', 'p2']);
    vi.advanceTimersByTime(10_001);
    const beats = MockSocket.instances[0].sent
      .map((s) => JSON.parse(s))
      .filter((m) => m.type === 'beat');
    expect(beats.map((b) => b.projectId).sort()).toEqual(['p1', 'p2']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/client/lib/presence-client.test.ts`
Expected: FAIL — `connect`, `subscribe`, `addListener` not defined.

- [ ] **Step 3: Implement WS lifecycle**

Replace the contents of `src/client/lib/presence-client.ts` with:

```typescript
type State = 'active' | 'idle';
type Opts = { now?: () => number; url?: string };

export type PresenceRowDto = {
  userId: string | null;
  displayName: string;
  state: State;
  lastBeatAt: number;
};
export type Snapshot = {
  rows: PresenceRowDto[];
  anonymousCount: number;
};
type Listener = (projectId: string, snap: Snapshot) => void;

export type PresenceClient = {
  computeState(): State;
  connect(): void;
  disconnect(): void;
  subscribe(consumerId: string, projectIds: string[]): void;
  addListener(fn: Listener): () => void;
  getSnapshot(projectId: string): Snapshot;
};

const BEAT_INTERVAL_MS = 10_000;
const IDLE_MS = 60_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export function createPresenceClient(opts: Opts = {}): PresenceClient {
  const now = opts.now ?? (() => Date.now());
  const url = opts.url ?? defaultUrl();
  let lastInputAt = now();
  let ws: WebSocket | null = null;
  let reconnectAttempts = 0;
  const consumers = new Map<string, Set<string>>();
  const subscribed = new Set<string>();
  const snapshots = new Map<string, Snapshot>();
  const listeners = new Set<Listener>();
  let lastSentState: State | null = null;

  const onInput = () => { lastInputAt = now(); };
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', onInput);
    window.addEventListener('mousemove', onInput);
    window.addEventListener('keydown', onInput);
    window.addEventListener('pointerdown', onInput);
    document.addEventListener('mousemove', onInput);
    document.addEventListener('keydown', onInput);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onInput();
      sendBeatNow();
    });
  }

  function computeState(): State {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return 'idle';
    return now() - lastInputAt < IDLE_MS ? 'active' : 'idle';
  }

  function defaultUrl(): string {
    if (typeof window === 'undefined') return '';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws/presence`;
  }

  function send(obj: unknown) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  }

  function sendSubscribe() {
    send({ type: 'subscribe', projectIds: [...subscribed] });
  }

  function sendBeatNow() {
    const state = computeState();
    lastSentState = state;
    for (const projectId of subscribed) {
      send({ type: 'beat', projectId, state });
    }
  }

  function recomputeSubscribed() {
    const next = new Set<string>();
    for (const ids of consumers.values()) {
      for (const id of ids) next.add(id);
    }
    let changed = next.size !== subscribed.size;
    if (!changed) {
      for (const id of next) if (!subscribed.has(id)) { changed = true; break; }
    }
    if (changed) {
      subscribed.clear();
      for (const id of next) subscribed.add(id);
      sendSubscribe();
    }
  }

  function emit(projectId: string, snap: Snapshot) {
    snapshots.set(projectId, snap);
    for (const fn of listeners) fn(projectId, snap);
  }

  function onMessage(evt: MessageEvent) {
    let msg: any;
    try { msg = JSON.parse(typeof evt.data === 'string' ? evt.data : ''); } catch { return; }
    if (msg?.type === 'presence' && typeof msg.projectId === 'string') {
      emit(msg.projectId, { rows: msg.rows ?? [], anonymousCount: msg.anonymousCount ?? 0 });
    }
  }

  let beatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (ws) return;
    ws = new WebSocket(url);
    ws.onopen = () => {
      reconnectAttempts = 0;
      sendSubscribe();
      sendBeatNow();
      beatTimer = setInterval(() => {
        const state = computeState();
        if (state !== lastSentState) sendBeatNow();
        else for (const projectId of subscribed) send({ type: 'beat', projectId, state });
      }, BEAT_INTERVAL_MS);
    };
    ws.onmessage = onMessage;
    ws.onclose = () => {
      if (beatTimer) { clearInterval(beatTimer); beatTimer = null; }
      ws = null;
      const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** reconnectAttempts);
      reconnectAttempts++;
      const jittered = delay * (0.5 + Math.random() * 0.5);
      reconnectTimer = setTimeout(connect, jittered);
    };
  }

  function disconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (beatTimer) { clearInterval(beatTimer); beatTimer = null; }
    ws?.close();
    ws = null;
  }

  function subscribe(consumerId: string, projectIds: string[]) {
    consumers.set(consumerId, new Set(projectIds));
    recomputeSubscribed();
  }

  function addListener(fn: Listener): () => void {
    listeners.add(fn);
    // Push current state to the new listener.
    for (const [projectId, snap] of snapshots) fn(projectId, snap);
    return () => { listeners.delete(fn); };
  }

  function getSnapshot(projectId: string): Snapshot {
    return snapshots.get(projectId) ?? { rows: [], anonymousCount: 0 };
  }

  return { computeState, connect, disconnect, subscribe, addListener, getSnapshot };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/client/lib/presence-client.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/presence-client.ts src/client/lib/presence-client.test.ts
git commit -m "feat(presence): client WS lifecycle, subscribe, beats, listeners"
```

---

## Task 9: Hooks — `usePresenceConnection` and `usePresence`

**Files:**
- Create: `src/client/hooks/usePresenceConnection.ts`
- Create: `src/client/hooks/usePresence.ts`
- Create: `src/client/hooks/usePresence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/client/hooks/usePresence.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Stub the singleton module so the hook test doesn't open a real socket.
const subscribeMock = vi.fn();
const addListenerMock = vi.fn();
const getSnapshotMock = vi.fn();
const listeners: Array<(p: string, s: any) => void> = [];

vi.mock('../lib/presence-client', () => ({
  createPresenceClient: () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    computeState: () => 'active',
    subscribe: subscribeMock,
    addListener: (fn: any) => { listeners.push(fn); addListenerMock(fn); return () => {}; },
    getSnapshot: getSnapshotMock,
  }),
}));

import { usePresence } from './usePresence';
import { PresenceProvider } from './usePresenceConnection';

beforeEach(() => {
  subscribeMock.mockClear();
  addListenerMock.mockClear();
  getSnapshotMock.mockReset();
  getSnapshotMock.mockReturnValue({ rows: [], anonymousCount: 0 });
  listeners.length = 0;
});

describe('usePresence', () => {
  it('calls subscribe with the requested project ids on mount and again on change', () => {
    const wrapper = ({ children }: any) => <PresenceProvider>{children}</PresenceProvider>;
    const { rerender } = renderHook(({ ids }) => usePresence(ids), {
      wrapper,
      initialProps: { ids: ['p1', 'p2'] },
    });
    const firstCall = subscribeMock.mock.calls.at(-1);
    expect(firstCall?.[1].sort()).toEqual(['p1', 'p2']);

    rerender({ ids: ['p1', 'p3'] });
    const secondCall = subscribeMock.mock.calls.at(-1);
    expect(secondCall?.[1].sort()).toEqual(['p1', 'p3']);
  });

  it('returns the latest snapshot when the client emits an event', () => {
    const wrapper = ({ children }: any) => <PresenceProvider>{children}</PresenceProvider>;
    const { result } = renderHook(() => usePresence(['p1']), { wrapper });
    act(() => {
      for (const fn of listeners) {
        fn('p1', { rows: [{ userId: 'u1', displayName: 'A', state: 'active', lastBeatAt: 1 }], anonymousCount: 0 });
      }
    });
    expect(result.current.p1.rows[0].displayName).toBe('A');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/client/hooks/usePresence.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `usePresenceConnection`**

Create `src/client/hooks/usePresenceConnection.ts`:

```typescript
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { createPresenceClient, type PresenceClient } from '../lib/presence-client';

const Ctx = createContext<PresenceClient | null>(null);

export function PresenceProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => createPresenceClient(), []);
  useEffect(() => {
    client.connect();
    return () => { client.disconnect(); };
  }, [client]);
  return <Ctx.Provider value={client}>{children}</Ctx.Provider>;
}

export function usePresenceClient(): PresenceClient {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePresenceClient must be used inside <PresenceProvider>');
  return c;
}
```

- [ ] **Step 4: Implement `usePresence`**

Create `src/client/hooks/usePresence.ts`:

```typescript
import { useEffect, useId, useMemo, useState } from 'react';
import { usePresenceClient } from './usePresenceConnection';
import type { Snapshot } from '../lib/presence-client';

export function usePresence(projectIds: string[]): Record<string, Snapshot> {
  const client = usePresenceClient();
  const consumerId = useId();
  // Stable JSON key keeps the effect from re-running on prop-array identity churn.
  const key = useMemo(() => [...projectIds].sort().join(','), [projectIds]);
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    client.subscribe(consumerId, ids);
    return () => { client.subscribe(consumerId, []); };
  }, [client, consumerId, key]);

  useEffect(() => {
    return client.addListener((projectId, snap) => {
      setSnapshots((prev) => ({ ...prev, [projectId]: snap }));
    });
  }, [client]);

  // Project the global snapshot map down to just the projects this hook cares about.
  return useMemo(() => {
    const ids = key ? key.split(',') : [];
    const out: Record<string, Snapshot> = {};
    for (const id of ids) out[id] = snapshots[id] ?? { rows: [], anonymousCount: 0 };
    return out;
  }, [snapshots, key]);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/client/hooks/usePresence.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/client/hooks/usePresenceConnection.ts src/client/hooks/usePresence.ts src/client/hooks/usePresence.test.ts
git commit -m "feat(presence): React hooks for connection and per-component subscription"
```

---

## Task 10: `<PresenceAvatars />` component + styles

**Files:**
- Create: `src/client/components/PresenceAvatars.tsx`
- Create: `src/client/components/PresenceAvatars.test.tsx`
- Modify: `src/client/styles/app.css`

- [ ] **Step 1: Write the failing test**

Create `src/client/components/PresenceAvatars.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Mock the hook so component tests don't need a real provider.
const usePresenceMock = vi.fn();
vi.mock('../hooks/usePresence', () => ({
  usePresence: (ids: string[]) => usePresenceMock(ids),
}));

import { PresenceAvatars } from './PresenceAvatars';

function snap(rows: any[], anonymousCount = 0) {
  return { 'proj-A': { rows, anonymousCount } };
}

describe('<PresenceAvatars />', () => {
  it('renders nothing when no rows and no anonymous viewers', () => {
    usePresenceMock.mockReturnValue(snap([]));
    const { container } = render(<PresenceAvatars projectId="proj-A" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders up to 3 member avatars and an overflow chip for the rest', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'Alice',   state: 'active', lastBeatAt: 5 },
      { userId: 'u2', displayName: 'Bob',     state: 'active', lastBeatAt: 4 },
      { userId: 'u3', displayName: 'Charlie', state: 'idle',   lastBeatAt: 3 },
      { userId: 'u4', displayName: 'Dora',    state: 'idle',   lastBeatAt: 2 },
      { userId: 'u5', displayName: 'Eve',     state: 'idle',   lastBeatAt: 1 },
    ]));
    render(<PresenceAvatars projectId="proj-A" />);
    expect(screen.getAllByTestId('presence-avatar')).toHaveLength(3);
    expect(screen.getByTestId('presence-overflow')).toHaveTextContent('+2');
  });

  it('orders active members ahead of idle, both by recency desc', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'OldActive',  state: 'active', lastBeatAt: 1 },
      { userId: 'u2', displayName: 'NewIdle',    state: 'idle',   lastBeatAt: 10 },
      { userId: 'u3', displayName: 'NewerActive', state: 'active', lastBeatAt: 5 },
    ]));
    render(<PresenceAvatars projectId="proj-A" />);
    const labels = screen.getAllByTestId('presence-avatar').map((el) => el.getAttribute('aria-label'));
    expect(labels[0]).toMatch(/NewerActive/);
    expect(labels[1]).toMatch(/OldActive/);
    expect(labels[2]).toMatch(/NewIdle/);
  });

  it('renders an anonymous chip when anonymousCount > 0', () => {
    usePresenceMock.mockReturnValue(snap([], 2));
    render(<PresenceAvatars projectId="proj-A" />);
    const chip = screen.getByTestId('presence-anon');
    expect(chip).toHaveTextContent('2');
    expect(chip).toHaveAttribute('aria-label', '2 anonymous viewers');
  });

  it('marks idle members in the aria-label and applies the idle class', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'Alice', state: 'idle', lastBeatAt: 1 },
    ]));
    render(<PresenceAvatars projectId="proj-A" />);
    const av = screen.getByTestId('presence-avatar');
    expect(av).toHaveAttribute('aria-label', expect.stringMatching(/Alice.*idle/));
    expect(av.className).toMatch(/presence-avatar-idle/);
  });

  it('dedupes the same userId across multiple tabs; active wins over idle', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'Alice', state: 'idle',   lastBeatAt: 5 },
      { userId: 'u1', displayName: 'Alice', state: 'active', lastBeatAt: 10 },
      { userId: 'u2', displayName: 'Bob',   state: 'active', lastBeatAt: 8 },
    ]));
    render(<PresenceAvatars projectId="proj-A" />);
    const avs = screen.getAllByTestId('presence-avatar');
    expect(avs).toHaveLength(2);
    expect(avs[0].getAttribute('aria-label')).toMatch(/Alice.*active/);
  });

  it('keeps anonymous (null-userId) rows separate from each other', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: null, displayName: 'X', state: 'active', lastBeatAt: 1 },
      { userId: null, displayName: 'Y', state: 'active', lastBeatAt: 2 },
    ]));
    render(<PresenceAvatars projectId="proj-A" />);
    // (In practice the server never sends member rows with userId=null; this
    // test just guards the dedup helper against collapsing nulls.)
    expect(screen.getAllByTestId('presence-avatar')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/client/components/PresenceAvatars.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement the component**

Create `src/client/components/PresenceAvatars.tsx`:

```tsx
import { Eye } from 'lucide-react';
import { usePresence } from '../hooks/usePresence';
import { paletteIndexForUserId, ANNOTATION_PALETTE } from '../lib/colors';
import type { PresenceRowDto } from '../lib/presence-client';

type Props = { projectId: string };

const MAX_AVATARS = 3;

function colorFor(userId: string | null): string {
  if (!userId) return '#6a6a6a';
  return ANNOTATION_PALETTE[paletteIndexForUserId(userId, ANNOTATION_PALETTE.length)];
}

function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : '?';
}

function dedupeByUserId(rows: PresenceRowDto[]): PresenceRowDto[] {
  // Same userId across multiple tabs collapses to one row: active wins,
  // then the most-recent lastBeatAt. Anonymous (null userId) rows are
  // never collapsed against each other.
  const byUser = new Map<string, PresenceRowDto>();
  const anon: PresenceRowDto[] = [];
  for (const row of rows) {
    if (row.userId == null) { anon.push(row); continue; }
    const existing = byUser.get(row.userId);
    if (!existing) { byUser.set(row.userId, row); continue; }
    const existingActive = existing.state === 'active';
    const incomingActive = row.state === 'active';
    if (incomingActive && !existingActive) { byUser.set(row.userId, row); continue; }
    if (incomingActive === existingActive && row.lastBeatAt > existing.lastBeatAt) {
      byUser.set(row.userId, row);
    }
  }
  return [...byUser.values(), ...anon];
}

function order(rows: PresenceRowDto[]): PresenceRowDto[] {
  const deduped = dedupeByUserId(rows);
  const active = deduped.filter((r) => r.state === 'active').sort((a, b) => b.lastBeatAt - a.lastBeatAt);
  const idle = deduped.filter((r) => r.state === 'idle').sort((a, b) => b.lastBeatAt - a.lastBeatAt);
  return [...active, ...idle];
}

export function PresenceAvatars({ projectId }: Props) {
  const map = usePresence([projectId]);
  const snap = map[projectId] ?? { rows: [], anonymousCount: 0 };
  if (snap.rows.length === 0 && snap.anonymousCount === 0) return null;

  const ordered = order(snap.rows);
  const visible = ordered.slice(0, MAX_AVATARS);
  const overflow = Math.max(0, ordered.length - MAX_AVATARS);
  const totalPeople = ordered.length + snap.anonymousCount;

  return (
    <div
      className="presence-avatars"
      role="group"
      aria-label={`${totalPeople} people viewing`}
    >
      {visible.map((row) => {
        const bg = colorFor(row.userId);
        const idle = row.state === 'idle';
        return (
          <div
            key={row.userId ?? row.lastBeatAt}
            data-testid="presence-avatar"
            className={'presence-avatar' + (idle ? ' presence-avatar-idle' : '')}
            style={{ background: bg, boxShadow: idle ? 'none' : `0 0 0 2px ${bg}` }}
            aria-label={`${row.displayName}, ${idle ? 'idle' : 'active'}`}
            title={`${row.displayName} — ${idle ? 'idle' : 'active'}`}
          >
            {initial(row.displayName)}
          </div>
        );
      })}
      {overflow > 0 && (
        <div className="presence-overflow" data-testid="presence-overflow">+{overflow}</div>
      )}
      {snap.anonymousCount > 0 && (
        <div
          className="presence-anon"
          data-testid="presence-anon"
          aria-label={`${snap.anonymousCount} anonymous viewers`}
          title={`${snap.anonymousCount} anonymous viewers`}
        >
          <Eye size={12} strokeWidth={2} aria-hidden="true" />
          <span>{snap.anonymousCount}</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add styles**

Append to `src/client/styles/app.css`:

```css
/* Presence indicators (Google-Docs-style avatars on projects). */
.presence-avatars {
  display: inline-flex;
  align-items: center;
  gap: 0;
}
.presence-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  margin-left: -6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  user-select: none;
}
.presence-avatar:first-child { margin-left: 0; }
.presence-avatar-idle {
  filter: grayscale(1);
  opacity: 0.55;
}
.presence-overflow {
  margin-left: 4px;
  padding: 0 6px;
  height: 24px;
  border-radius: 12px;
  background: var(--surface-elevated, #f0f0f0);
  color: var(--text-secondary, #444);
  font-size: 11px;
  display: inline-flex;
  align-items: center;
}
.presence-anon {
  margin-left: 4px;
  padding: 0 6px;
  height: 24px;
  border-radius: 12px;
  background: var(--surface-elevated, #f0f0f0);
  color: var(--text-secondary, #444);
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/client/components/PresenceAvatars.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/PresenceAvatars.tsx src/client/components/PresenceAvatars.test.tsx src/client/styles/app.css
git commit -m "feat(presence): <PresenceAvatars /> component"
```

---

## Task 11: Wire into `App`, `ProjectPicker`, `AppHeader`

**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/client/components/ProjectPicker.tsx`
- Modify: `src/client/components/AppHeader.tsx`

- [ ] **Step 1: Mount the provider**

In `src/client/App.tsx`, locate the root JSX returned by the top-level `App` component. Wrap it with `<PresenceProvider>` so every descendant can call `usePresence(...)`. Add the import:

```typescript
import { PresenceProvider } from './hooks/usePresenceConnection';
```

Wrap the existing tree, for example:

```tsx
return (
  <PresenceProvider>
    {/* ... existing top-level JSX unchanged ... */}
  </PresenceProvider>
);
```

If the existing return is a fragment, replace the fragment with `<PresenceProvider>` directly. Do not add the provider inside `PublicProjectView` — public-link viewers either don't render avatars or do so via a separate, anonymous code path covered in Task 12.

- [ ] **Step 2: Render in `ProjectPicker` rows**

In `src/client/components/ProjectPicker.tsx`, add the import:

```typescript
import { PresenceAvatars } from './PresenceAvatars';
```

Inside `ProjectRow` (the function near the bottom of the file), insert `<PresenceAvatars projectId={p.id} />` immediately before the existing `fp-cell-actions` span. Adjust the surrounding markup so the avatars get their own cell:

```tsx
<span className="fp-cell-presence">
  <PresenceAvatars projectId={p.id} />
</span>
<span className="fp-cell-actions">{/* existing actions */}</span>
```

Add a matching skeleton placeholder in the loading state (the `[0,1,2,3,4].map(...)` block) so column layout doesn't jump on load:

```tsx
<span className="fp-cell-presence fp-skel fp-skel-meta" />
```

Append CSS for `.fp-cell-presence` in `src/client/styles/app.css`:

```css
.fp-cell-presence { display: flex; align-items: center; justify-content: flex-end; min-width: 96px; }
```

- [ ] **Step 3: Render in `AppHeader`**

In `src/client/components/AppHeader.tsx`, add the import:

```typescript
import { PresenceAvatars } from './PresenceAvatars';
```

Extend the `Props` type with the current project id:

```typescript
currentProjectId: string | null;
```

In the JSX, immediately before the avatar dropdown (find the `userInitials` rendering — the dropdown button with the initials circle), insert:

```tsx
{hasProject && currentProjectId && !publicMode ? (
  <PresenceAvatars projectId={currentProjectId} />
) : null}
```

Then update the caller in `App.tsx` to pass `currentProjectId={activeProjectId}` (or the local variable holding the open project's id — grep `<AppHeader` in `App.tsx` to find existing call sites; there may be more than one).

- [ ] **Step 4: Typecheck and run unit tests**

Run:
```bash
npx tsc --noEmit
npx vitest run
```
Expected: typecheck PASS. All existing tests still PASS. `AppHeader.test.tsx` may need a `currentProjectId={null}` prop added to fixtures — update those fixtures inline.

- [ ] **Step 5: Visual verification**

Start dev:
```bash
npm run dev
```
In two browser windows, sign in as `dev@paperstem.local` in window A and as `alice@paperstem.local` in window B (create the second user via `npm run add-user` if needed). Open the same project in both. Confirm both windows show the other's avatar with an active ring. Hide one tab and wait 70s. Confirm the avatar in the other window flips to grayscale.

If you have `preview_start` available, capture a screenshot of the picker row with the avatar visible and post it inline.

- [ ] **Step 6: Commit**

```bash
git add src/client/App.tsx src/client/components/ProjectPicker.tsx src/client/components/AppHeader.tsx src/client/styles/app.css
git commit -m "feat(presence): render avatars in picker rows and header"
```

---

## Task 12: Public-link anonymous viewer wiring

**Files:**
- Modify: `src/client/PublicProjectView.tsx`
- Modify: `src/client/lib/presence-client.ts`

- [ ] **Step 1: Allow the client to attach a public-link token**

In `src/client/lib/presence-client.ts`, extend `Opts` and `defaultUrl()`:

```typescript
type Opts = { now?: () => number; url?: string; linkToken?: string };
```

```typescript
function defaultUrl(): string {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${proto}//${window.location.host}/ws/presence`;
  return opts.linkToken ? `${base}?link=${encodeURIComponent(opts.linkToken)}` : base;
}
```

(Capture `opts` in the closure — it's already in scope.)

- [ ] **Step 2: Mount a public PresenceProvider in `PublicProjectView`**

Read the existing top-level JSX in `src/client/PublicProjectView.tsx`. Where the page resolves the token (already present — used for `/api/public/links/:token/...`), wrap the project view with a `<PresenceProvider>` that passes `linkToken`:

```tsx
import { createPresenceClient } from './lib/presence-client';
// ... inside the component, after token is in scope:
const client = useMemo(() => createPresenceClient({ linkToken: token }), [token]);
useEffect(() => { client.connect(); return () => { client.disconnect(); }; }, [client]);
// Reuse the Ctx exported by usePresenceConnection by constructing the provider inline:
```

The cleanest path is to export the raw context from `usePresenceConnection.ts` and supply it manually here:

In `src/client/hooks/usePresenceConnection.ts`, also export the context:

```typescript
export const PresenceContext = Ctx;
```

Then in `PublicProjectView.tsx`:

```tsx
import { PresenceContext } from './hooks/usePresenceConnection';
// ...
return (
  <PresenceContext.Provider value={client}>
    {/* ... existing JSX ... */}
  </PresenceContext.Provider>
);
```

Public viewers will subscribe to their project, get rows = [] (anonymous filter on the server side), and their tab counts toward `anonymousCount`. They do not see member identities.

- [ ] **Step 3: Manual verification**

With the dev server running, generate a public link from the picker for a project that has at least one signed-in member active. Open the public URL in an incognito window. In the signed-in window, confirm the eye-icon chip appears with count 1. Closing the incognito tab makes the chip vanish within ~10s.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/presence-client.ts src/client/hooks/usePresenceConnection.ts src/client/PublicProjectView.tsx
git commit -m "feat(presence): include anonymous public-link viewers in counts"
```

---

## Task 13: End-to-end test

**Files:**
- Create: `tests/e2e/journeys/presence.spec.ts`

- [ ] **Step 1: Write the e2e journey**

Read `tests/e2e/journeys/` and pick the closest existing pattern (e.g., a two-user journey if one exists). Then create `tests/e2e/journeys/presence.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test('two members see each other in presence; idle flip when hidden', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  // Both sign in via the dev-login affordance. The launcher prints a
  // Dev login URL; in CI we hit /api/auth/dev-login with a query param.
  // Use the existing helper in tests/e2e/helpers/ if one exists; otherwise:
  await pageA.goto('/api/auth/dev-login?email=alice@paperstem.local');
  await pageB.goto('/api/auth/dev-login?email=bob@paperstem.local');
  await pageA.goto('/');
  await pageB.goto('/');

  // Both open the same project. The seed helper or the picker should make
  // a project available; pick the first row in the picker.
  await pageA.getByRole('button', { name: /open|projects/i }).click();
  const firstRowA = pageA.getByTestId('fp-row').first();
  await firstRowA.click();
  await pageB.getByRole('button', { name: /open|projects/i }).click();
  const firstRowB = pageB.getByTestId('fp-row').first();
  await firstRowB.click();

  // Each page should see the other's avatar inside the header presence group.
  await expect(pageA.locator('.presence-avatars [data-testid="presence-avatar"]')).toHaveCount(1, { timeout: 15_000 });
  await expect(pageB.locator('.presence-avatars [data-testid="presence-avatar"]')).toHaveCount(1, { timeout: 15_000 });

  // Hide page B and confirm A's view of B flips to idle within the next
  // beat interval + sweep window.
  await pageB.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(pageA.locator('.presence-avatar-idle')).toHaveCount(1, { timeout: 90_000 });

  await ctxA.close();
  await ctxB.close();
});
```

- [ ] **Step 2: Adjust selectors to actual DOM**

Run the test once: `npm run test:e2e -- presence`. It will likely fail on selectors. Read `tests/e2e/journeys/` for the project-row testid (`fp-row` vs `fp-row-link` etc.) and update the selectors to match. Re-run until it passes.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/journeys/presence.spec.ts
git commit -m "test(e2e): presence avatars appear between members and flip to idle"
```

---

## Task 14: Docs + final verification

**Files:**
- Modify: `docs/testing.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a WebSocket testing subsection**

Open `docs/testing.md`. In the "Categories" list, add a `WebSocket handlers` link. Append a section:

```markdown
### WebSocket handlers

**Canonical example:** `src/server/presence-ws.test.ts`. It spins up an in-process Hono app with `@hono/node-ws`, listens on an ephemeral port, and drives the endpoint with the real `ws` client library. Use this pattern for any future WS route: a `beforeAll` that constructs the app + injects WS + binds port 0, a small `openWs()` helper that returns a connected `ws` client, and a `nextMessage()` promise wrapper.
```

- [ ] **Step 2: Update `CLAUDE.md`**

In `CLAUDE.md`, in the "Architecture in one paragraph" section, append after the existing sentence about Hono routes:

```markdown
A `/ws/presence` WebSocket endpoint (via `@hono/node-ws`) carries Google-Docs-style project presence with an in-memory registry — no DB writes; see [docs/superpowers/specs/2026-05-16-project-presence-design.md](docs/superpowers/specs/2026-05-16-project-presence-design.md).
```

- [ ] **Step 3: Full verification suite**

Run:
```bash
npx tsc --noEmit
npx vitest run
npm run build
npm run test:e2e
```
Expected: every command exits 0. If `test:e2e` fails for environmental reasons (Chromium download, etc.) document the failure and resolve before opening the PR — do not skip it; CLAUDE.md flags presence as a cross-component flow where e2e is required.

- [ ] **Step 4: Commit and open PR**

```bash
git add docs/testing.md CLAUDE.md
git commit -m "docs(presence): WS test pattern + architecture note"
git push -u origin <branch>
gh pr create --title "feat(presence): Google-Docs-style project presence indicators" --body "$(cat <<'EOF'
## Summary
- Adds `/ws/presence` over `@hono/node-ws` with an in-memory registry.
- `<PresenceAvatars />` rendered in `ProjectPicker` rows and `AppHeader`.
- Active/idle from tab visibility + 60s input window.
- Anonymous public-link viewers counted, never named.

Spec: docs/superpowers/specs/2026-05-16-project-presence-design.md

## Test plan
- [ ] vitest unit suite green
- [ ] Playwright presence journey green
- [ ] Manual: two browsers see each other; idle flip after hide
- [ ] Manual: incognito public link shows eye chip

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash --delete-branch
```

---

## Notes for the implementor

- The plan keeps the registry purely in-memory by design. If you find yourself reaching for SQLite, stop — re-read the spec; persistence was explicitly rejected.
- `@hono/node-ws`'s `upgradeWebSocket` requires the handler to be synchronous. If you need async DB checks for auth, do them in the handler factory (before returning the events object) — that runs during the upgrade and can throw to reject.
- Two-tab dedup happens client-side in `<PresenceAvatars />` via the `userId ?? lastBeatAt` key. Server-side rows stay separate per `connId` — don't try to dedupe there.
- The picker row's `fp-cell-presence` cell needs CSS column sizing; if the row layout uses CSS grid (check `.fp-row` rules), add the cell to the column template too.
