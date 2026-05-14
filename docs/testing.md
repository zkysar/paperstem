# Testing

Conventions for adding unit tests to Paperstem. The repo uses vitest with two projects: a `client` project running under happy-dom for React tests, and a `server` project running under node for everything else. See `vitest.config.ts`.

## Running tests

- `npx vitest run` — full suite.
- `npx vitest run <path>` — single file or pattern.
- `npx vitest` — watch mode.
- `npm test` — alias for `vitest run`.

The pre-push hook (`scripts/git-hooks/pre-push`) runs `npm run build` and `vitest` before any push; failures block the push.

## Project split

`vitest.config.ts` defines two projects:

- **client** — `src/client/**/*.test.{ts,tsx}`, environment `happy-dom`. Loads `src/client/test-setup.ts` first (installs an in-memory `localStorage` polyfill for Node 25, stubs `window.confirm`, and filters happy-dom network-fetch noise).
- **server** — `src/server/**/*.test.ts` and `bin/**/*.test.ts`, environment `node`.

The split exists because server tests need a real Node environment (better-sqlite3, fs, busboy) and client tests need DOM globals.

## Where test files go

Tests live next to the code they cover, named `<file>.test.ts` or `<file>.test.tsx`. Do not put tests in a separate `tests/` directory.

## Fixtures vs. inline literals

Prefer inline literals (object constructors, hand-rolled buffers) over fixture files for anything under ~50 bytes or trivially generated. Use fixture files in `src/<area>/__fixtures__/` only when the input is a real binary blob that's expensive to construct in code (e.g. WAV files for the import tests).

## Categories

(Filled in by subsequent tasks.)

- [Server route handlers](#server-route-handlers)
- [Server libs](#server-libs)
- [Server migrations](#server-migrations)
- Server jobs
- Server import
- Server auth
- Client components
- Client hooks
- Client libs
- Bin scripts

### Server route handlers

**Canonical example:** `src/server/projects.test.ts`. It exercises read, rename, soft-delete, and restore endpoints; uses Drive mocking; calls `_resetTokenCacheForTests`; and shows every helper factory in use. It is the most self-contained and broadly representative file in the category.

> **Note:** `src/server/onboard-band.test.ts` lives in this directory but is a bin-script test, not a route-handler test — it spawns a subprocess via `spawnSync` and never constructs a Hono `app`. See the Bin scripts section.

#### Harness setup

```typescript
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- env prelude (must happen before any import of db.ts / drive.ts / mailer.ts) ----
const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-myroute-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';
// Only needed when the route under test calls Drive:
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csec';
process.env.GOOGLE_REFRESH_TOKEN = 'rtok';

// ---- module-level type aliases (avoids repeated typeof import) ----
type DbModule = typeof import('./db.js');
type MyRouteModule = typeof import('./my-route.js');
type DriveModule = typeof import('./drive.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let myRouteMod: MyRouteModule;
let driveMod: DriveModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

// ---- dynamic imports inside beforeAll (required: env vars must be set first) ----
beforeAll(async () => {
  dbMod = await import('./db.js');
  myRouteMod = await import('./my-route.js');
  driveMod = await import('./drive.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  // Register only the routes under test; keep the surface minimal.
  app.get('/api/my-resources', myRouteMod.handleList);
  app.post('/api/my-resources', myRouteMod.handleCreate);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});
```

**Why dynamic imports?** `db.ts`, `drive.ts`, and `mailer.ts` all read env vars at module initialisation time. If they are imported before `process.env.DATABASE_PATH` (and the Google/Gmail vars) are set, they will throw or open the wrong database. Setting env vars first and importing inside `beforeAll` is the only safe ordering in vitest's node environment.

#### Helper factories

All four helpers are local functions defined at the top of each test file. They are **not** exported from `db.ts`.

| Factory | Returns | Side effects |
|---|---|---|
| `createUser(email)` | `string` — the new user UUID | Inserts one row into `users` via `dbMod.stmts.insertUser` |
| `createBand(name, ownerId)` | `string` — the new band UUID | Inserts into `bands` and creates an `owner` membership row via `dbMod.stmts.insertBand` + `insertMembership` |
| `createSession(userId)` | `string` — the session ID | Inserts a session that expires one hour from now via `dbMod.stmts.insertSession` |
| `cookieHeader(sid)` | `string` — e.g. `"paperstem_session=<sid>"` | None; reads `cookieMod.SESSION_COOKIE_NAME` so the cookie name stays in sync with the implementation |

A few tests extend these with local helpers (`insertProject`, `insertStem`, `createProjectAndStem`, etc.) that call `dbMod.stmts.*` directly to set up more specific fixtures.

#### The `reset()` pattern

```typescript
function reset() {
  dbMod.db.exec(
    'DELETE FROM stems; DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
  driveMod._resetTokenCacheForTests();
  vi.restoreAllMocks();
}

beforeEach(() => {
  reset();
});
```

The DELETE order matters: child tables before parents (foreign keys are enforced). `sessions` and `magic_links` are cleared even when a test does not exercise auth flows — leftover sessions from a previous test could accidentally authenticate a request in the next one. `memberships` is cleared before `bands` and `users` for the same reason.

`vi.restoreAllMocks()` undoes any `vi.spyOn(globalThis, 'fetch')` calls from the previous test so mock implementations do not bleed across tests.

#### Drive mock convention

Tests that exercise routes that call the Drive API mock `globalThis.fetch` with `vi.spyOn`:

```typescript
vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
  const url = typeof input === 'string' ? input : (input as Request).url;
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    return new Response(
      JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
  // ... handle other Drive URLs or return a stub response
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
});
```

`driveMod._resetTokenCacheForTests()` clears the in-memory OAuth token cache that `drive.ts` maintains. Without it, a token fetched (or mocked) in one test would be reused in the next, potentially defeating the spy. It is called in `reset()` alongside `vi.restoreAllMocks()`.

> **Sunset note:** `_resetTokenCacheForTests` and the `vi.spyOn(globalThis, 'fetch')` pattern for Drive are temporary. Drive is being removed from the codebase; once that work lands, both the Drive mock setup and the `_resetTokenCacheForTests` call in `reset()` will be deleted from all route-handler tests.

#### What to assert

Assert **status code first**, then **parse the JSON body** and check its shape:

```typescript
// From projects.test.ts — happy-path rename
const res = await app.fetch(
  new Request(`http://localhost/api/projects/${pid}`, {
    method: 'PATCH',
    headers: {
      Cookie: cookieHeader(sid),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'new name' }),
  }),
);
expect(res.status).toBe(200);
const body = (await res.json()) as { ok: boolean; name: string };
expect(body).toMatchObject({ ok: true, name: 'new name' });

// From projects.test.ts — non-member gets 404, no Drive call happens
const fetchSpy = vi.spyOn(globalThis, 'fetch');
const res = await app.fetch(
  new Request(`http://localhost/api/projects/${pid}`, {
    method: 'PATCH',
    headers: { Cookie: cookieHeader(sid), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'new name' }),
  }),
);
expect(res.status).toBe(404);
expect(fetchSpy).not.toHaveBeenCalled();
```

Use `toMatchObject` when you want to check a subset of fields; use `toEqual` when you want an exact match. For security-sensitive responses, confirm that internal fields like `drive_file_id` are absent from the serialised response body rather than just from the typed object.

#### What not to do

No significant anti-patterns were spotted across the nine files. A few minor notes:

- `bands.test.ts` names its reset function `resetTables()` instead of `reset()`. This is cosmetic but inconsistent with the other files; prefer `reset()` for uniformity.
- `annotations.test.ts` omits `driveMod._resetTokenCacheForTests()` and `vi.restoreAllMocks()` from its `reset()` — acceptable because annotations routes never call Drive, but it means the function signature diverges from the canonical pattern. If Drive calls are ever added to annotations, the omission will be easy to miss.

### Server libs

**Canonical example:** `src/server/auth/rate-limit.test.ts`. It is the purest example in the category: a plain import, no DB, no Hono app, no `beforeEach`/`afterEach` setup, just `describe`/`it` with direct assertions against a single class.

Pure-function server modules are uncommon in this codebase — most `src/server/*.ts` is exposed through a Hono handler and shows up under [Server route handlers](#server-route-handlers) instead. The auth helpers (`rate-limit.ts`, `cookie.ts`) are the main exceptions.

#### Harness setup

None. These tests import the module under test directly and exercise it inline.

```typescript
import { describe, expect, it } from 'vitest';
import { TokenBucketLimiter } from './rate-limit.js';

describe('TokenBucketLimiter', () => {
  it('allows the first request and blocks the second within the window', () => {
    // ...
  });
});
```

No `beforeAll`, no DB path, no env prelude, no fixture helpers.

#### What to assert

Test representative inputs, boundary values, and refill/capacity behavior. From `rate-limit.test.ts`:

```typescript
// Boundary: refill triggers exactly at the interval, not one ms before
now += 59_999;
expect(limiter.tryConsume('a')).toBe(false);
now += 1;
expect(limiter.tryConsume('a')).toBe(true);

// Capacity cap: long idle does not accumulate tokens beyond capacity
now += 600_000;
expect(limiter.tryConsume('a')).toBe(true);
expect(limiter.tryConsume('a')).toBe(true);
expect(limiter.tryConsume('a')).toBe(false);
```

Where the class accepts an injectable clock (`() => now`), use it — it removes real-time dependency and lets tests advance time without `sleep`.

`src/server/auth/cookie.test.ts` is a near-lib test: it exercises `setSessionCookie` and `SESSION_COOKIE_NAME` against a hand-rolled Hono context stub, with `beforeEach` flipping `NODE_ENV`. It is slightly more involved than a pure lib test because the function under test depends on env state and writes to a response object.

#### What not to do

Don't reach for mocks or fakes when the function is pure. If the unit you're testing is not pure — it calls the DB, calls Drive, or handles HTTP — it belongs in another category:

- Has a `c: Context` parameter and returns a `Response`? Route handler.
- Runs in a scheduler loop, reads from DB, writes back? Job.
- Reads a raw binary buffer to produce structured data? Server import.
- Opens and mutates a SQLite schema? Migration.

### Server migrations

**Canonical example:** `src/server/migrate-rename.test.ts`. It is the most complete of the three: it tests a named migration function directly, covers the full schema (tables, FK columns, indexes), includes explicit idempotency cases, and uses in-memory SQLite — so there are no temp-dir fixtures or env-var preconditions to manage.

#### Harness setup

Migration tests use one of two approaches depending on whether the migration runs through `db.ts` initialization or is exposed as a standalone function.

**Standalone migration function (preferred):** Use an in-memory DB, seed the pre-migration schema with raw SQL via `db.exec`, then call the migration function directly. No env prelude, no dynamic imports.

```typescript
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { renamePracticesToProjects } from './migrate-rename.js';

// Helper to seed the legacy schema (approximates pre-rebrand state).
function seedLegacy(db: Database.Database): void {
  db.exec(`
    CREATE TABLE practices (
      id TEXT PRIMARY KEY,
      band_id TEXT NOT NULL,
      ...
    );
    CREATE INDEX idx_practices_band_recorded ON practices(band_id, recorded_on DESC);
    CREATE TABLE stems (
      id TEXT PRIMARY KEY,
      practice_id TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
      ...
    );
    INSERT INTO practices (...) VALUES (...);
    INSERT INTO stems (...) VALUES (...);
  `);
}

it('renames tables and preserves data', () => {
  const db = new Database(':memory:');
  seedLegacy(db);

  renamePracticesToProjects(db);

  // assert post-migration state ...
});
```

**Migration runs on `db.ts` import:** Set `process.env.DATABASE_PATH` to a real on-disk path (inside a `mkdtempSync` temp dir) before importing `db.ts`. Seed the pre-migration schema with a separate `better-sqlite3` connection, close it, then `await import('./db.js')`. The migration fires as a side effect of the import.

```typescript
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-migration-test-'));
const dbPath = join(tmpDir, 'pre-migration.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

it('runs migration on db import', async () => {
  const seed = new Database(dbPath);
  seed.exec(`CREATE TABLE practices (...); INSERT INTO practices ...`);
  seed.close();

  const dbMod = await import('./db.js');  // migration fires here

  // assert via dbMod.db ...
});
```

`GMAIL_USER` and `GMAIL_APP_PASSWORD` are required because `mailer.ts` reads them at module-init time and is pulled in transitively by `db.ts`.

#### What to assert

**Schema shape** — use `PRAGMA table_info(<table>)` and `sqlite_master` to confirm columns exist or have been removed, tables have been renamed, and indexes have been dropped:

```typescript
// From migrate-rename.test.ts — column existence check
function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (r) => r.name,
  );
}
expect(columnNames(db, 'stems')).toContain('project_id');
expect(columnNames(db, 'stems')).not.toContain('practice_id');

// Index cleanup check
function indexNames(db: Database.Database): string[] {
  return (
    db.prepare(`SELECT name FROM sqlite_master WHERE type='index' ORDER BY name`)
      .all() as { name: string }[]
  ).map((r) => r.name);
}
expect(indexNames(db)).not.toContain('idx_practices_band_recorded');
```

**Data preservation** — insert rows with known values before running the migration, then query them by primary key after:

```typescript
// From migrate-rename.test.ts
const p = db.prepare('SELECT name FROM projects WHERE id = ?').get('p1') as { name: string };
expect(p.name).toBe('old session');
const s = db.prepare('SELECT project_id FROM stems WHERE id = ?').get('s1') as { project_id: string };
expect(s.project_id).toBe('p1');
```

#### Idempotency

When the migration function guards itself (checks whether the old table exists before acting), write an explicit idempotency test: call the function two or three times on the same DB and assert the final state is identical to the single-run case.

```typescript
// From migrate-rename.test.ts
it('is idempotent when run repeatedly on a legacy DB', () => {
  const db = new Database(':memory:');
  seedLegacy(db);

  renamePracticesToProjects(db);
  renamePracticesToProjects(db);
  renamePracticesToProjects(db);

  expect(tableNames(db)).toContain('projects');
  expect(tableNames(db)).not.toContain('practices');
  expect(columnNames(db, 'stems')).toContain('project_id');
});
```

Also test the no-op case: if the DB is already at the target schema (or has no relevant tables at all), the migration should not throw and should leave state unchanged.

#### What not to do

- **Do not rely on test-file ordering.** Each test builds its own DB from scratch. Never set up legacy state in one `it` block and run the migration in another — vitest may re-order or isolate tests.
- **Do not use the global `dbMod.db` connection across multiple test files.** `db.ts` is a module singleton; once imported, the connection is shared for the rest of the vitest worker. The `db.ts`-import pattern (used by `schema-migration.test.ts`) runs the migration exactly once per worker. If you add a second file that also `await import('./db.js')`, it will receive the already-migrated singleton, not a fresh one.
- **Do not skip the `seed.close()` call** before importing `db.ts`. better-sqlite3 opens the file in exclusive WAL mode by default; leaving two open connections on the same path leads to lock errors.
