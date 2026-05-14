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

Prefer inline literals or small helper builders over fixture files. The repo currently has no `__fixtures__/` directories — even the binary WAV tests build their data via local helpers like `buildWav()` (see `src/server/import/wav-cue.test.ts`). If you add real fixture files later, put them in `src/<area>/__fixtures__/` and document the convention here.

## Categories

(Filled in by subsequent tasks.)

- [Server route handlers](#server-route-handlers)
- [Server libs](#server-libs)
- [Server migrations](#server-migrations)
- [Server jobs](#server-jobs)
- [Server import](#server-import)
- [Server auth](#server-auth)
- [Client components](#client-components)
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

### Server jobs

**Canonical example:** `src/server/jobs/scheduler.test.ts`. It is the cleaner of the two: all tests are pure — each passes a `nowMs` timestamp directly to the delay-calculation helper and asserts the return value, with no env prelude, no DB, no fake timers, and no async setup. `src/server/jobs/backups.test.ts` is representative for testing exported synchronous utilities (`buildBandDump`, `selectFilesToDelete`) that require a real DB but still avoid any scheduler lifecycle.

The jobs layer has two distinct testing surfaces:

1. **Delay-calculation helpers** (`msUntilNextDailyUtc`, `msUntilNextWeeklyUtc`) — pure functions; pass a timestamp in, get a millisecond delay back.
2. **Job utilities** (`buildBandDump`, `selectFilesToDelete`) — synchronous or synchronous-enough functions that read/write a DB; test them in isolation with the same DB harness used by route-handler tests.

The scheduler _lifecycle_ (`startScheduler`, `stopScheduler`, and the `setTimeout` loop) and the in-flight deduplication (`runInFlight`) in `snapshots.ts`/`backups.ts` are not directly tested — see **What not to do** below.

#### Harness setup

**Delay-calculation helpers — no harness needed:**

```typescript
import { describe, expect, it } from 'vitest';
import {
  msUntilNextDailyUtc,
  msUntilNextWeeklyUtc,
} from './scheduler.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;
const WEEK_MS = 7  * DAY_MS;

describe('msUntilNextDailyUtc', () => {
  it('returns time until later same day when before target hour', () => {
    const now = Date.UTC(2026, 4, 7, 1, 0, 0);
    expect(msUntilNextDailyUtc(now, 3)).toBe(2 * HOUR_MS);
  });
});
```

No `beforeAll`, no env vars, no fake timers. The function receives `nowMs` as a parameter — the injectable timestamp is the entire harness.

**Job utilities that touch the DB — same env-prelude + dynamic-import pattern as route handlers:**

```typescript
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-backups-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csec';
process.env.GOOGLE_REFRESH_TOKEN = 'rtok';

type DbModule    = typeof import('../db.js');
type BackupsMod  = typeof import('./backups.js');

let dbMod: DbModule;
let backupsMod: BackupsMod;

beforeAll(async () => {
  dbMod     = await import('../db.js');
  backupsMod = await import('./backups.js');
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  dbMod.db.exec(
    'DELETE FROM annotations; DELETE FROM stems; DELETE FROM projects; ' +
    'DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; ' +
    'DELETE FROM magic_links; DELETE FROM users;',
  );
}

beforeEach(() => { reset(); });
```

The env-prelude-before-dynamic-import rule applies for the same reason as route handlers: `db.ts` and `mailer.ts` both read env vars at module initialisation time.

#### What to assert

**Timing math:** cover the boundary cases for each helper — before the target hour, after the target hour, exactly at the target hour (must roll forward one full period, not fire immediately), and cross-month or cross-week boundaries. From `scheduler.test.ts`:

```typescript
// Rolls forward exactly one day when called at the target hour
it('rolls forward exactly one day when called at the target hour', () => {
  const now = Date.UTC(2026, 4, 7, 3, 0, 0);
  expect(msUntilNextDailyUtc(now, 3)).toBe(DAY_MS);
});

// Month boundary: target lands in a different month
it('handles month boundary', () => {
  const now = Date.UTC(2026, 4, 31, 23, 30, 0);
  const ms  = msUntilNextDailyUtc(now, 3);
  const target = new Date(now + ms);
  expect(target.getUTCMonth()).toBe(5);   // June
  expect(target.getUTCDate()).toBe(1);
  expect(target.getUTCHours()).toBe(3);
});
```

**DB dump contents:** assert that `buildBandDump` returns a valid SQLite buffer (`Buffer.isBuffer(buf)`) that opens cleanly, contains the expected tables, scopes data to the selected band (not other bands' rows), and strips auth-sensitive tables. From `backups.test.ts`:

```typescript
// Sessions and magic_links are present as empty tables — not omitted
const mlCount = dump.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM magic_links').get();
expect(mlCount?.c).toBe(0);

// Only the target band's projects appear
const projects = dump.prepare<[], { id: string; band_id: string }>(
  'SELECT id, band_id FROM projects'
).all();
expect(projects).toHaveLength(1);
expect(projects[0].band_id).toBe(bandA);
```

**Retention logic:** assert that `selectFilesToDelete` keeps the N newest dumps by lexicographic filename order, returns empty when fewer than `retain` are present, and ignores non-dump files (e.g. `README.md`). From `backups.test.ts`:

```typescript
const toDelete = backupsMod.selectFilesToDelete(files, 3);
expect(toDelete.map(f => f.id).sort()).toEqual(['1', '2']); // oldest two dropped
```

**In-flight deduplication (`runInFlight`):** `snapshots.ts` and `backups.ts` both guard against concurrent runs:

```typescript
// From snapshots.ts / backups.ts
let runInFlight: Promise<void> | null = null;
export async function runSnapshotsNow(): Promise<void> {
  if (runInFlight) return runInFlight;
  // ...
}
```

If you add a test for the job entry point (`runSnapshotsNow`, `runBackupsNow`), assert idempotency explicitly: calling the function twice in rapid succession should result in only one execution, not two. The simplest assertion is a spy on a downstream call (e.g. `vi.spyOn(driveMod, 'uploadFile')`) confirming it is invoked only once even when the function is called concurrently.

#### What not to do

- **Do not use real `setTimeout` delays to exercise scheduler timing.** The scheduler (`startScheduler`) relies on wall-clock `setTimeout` with delays up to 24 hours. Testing it without fake timers is either instant-but-meaningless or painfully slow. Use `msUntilNextDailyUtc` / `msUntilNextWeeklyUtc` directly — they accept a `nowMs` parameter that makes time injectable without any vitest fake-timer setup.
- **Do not share scheduler state across tests without stopping it.** `startScheduler` sets module-level `snapshotTimer` and `backupTimer`. If you start the scheduler in one test and do not call `stopScheduler` in teardown, the dangling timers will fire in later tests and pollute results. If testing lifecycle, always pair `startScheduler` with `stopScheduler` in `afterEach`.
- **Do not import `db.ts` before setting `process.env.DATABASE_PATH`.** The env prelude (setting `DATABASE_PATH`, `GMAIL_USER`, etc.) must appear at module level, before any `import` or `await import` that transitively loads `db.ts` or `mailer.ts`. See the route-handler section for the full explanation.

### Server import

This category covers the `src/server/import/` modules and the `bin/import-from-device.ts` orchestrator. It mixes two distinct testing surfaces:

1. **Binary parsing tests** — read WAV chunk structures and return structured data (`readCuePoints`, `model12.scan`). No DB, no HTTP, no env prelude needed.
2. **Orchestration tests** — invoke the end-to-end device-import flow (`runImporter`), which scans a fake SD card, calls the Paperstem API, and writes marker files to disk.

**Canonical examples:**

- **Parsing: `src/server/import/wav-cue.test.ts`** — the purest example. A single `buildWav()` helper constructs a RIFF/WAVE buffer from parameters, `writeTempWav()` drops it into a `mkdtempSync` dir, and `readCuePoints()` is called against the resulting path. No setup beyond the buffer construction; assertions are direct equality checks on the returned sample-offset array.
- **Orchestration: `bin/import-from-device.test.ts`** — the sole end-to-end test. It builds a fake SD card tree in a `mkdtempSync` dir, injects a `vi.fn()` fetch mock and an `encodeFn` stub, calls `runImporter()`, then asserts `result.status` and the marker file written to the card.

#### Where fixtures live

There is no `__fixtures__/` directory. All WAV input data is generated programmatically using a `buildWav()` (or `buildSilentWav()`) helper function defined at the top of each parsing test file. The helper assembles RIFF, `fmt `, `cue `, and `data` chunks from Buffer writes and returns a complete in-memory `Buffer`. That buffer is written to a `mkdtempSync` temporary directory before the function under test is called.

This is intentional: the WAV structures relevant to these tests (cue-chunk layout, sample offsets, reserved empty slots) are simple enough to construct in ~50 lines of Buffer manipulation, and doing so keeps the tests self-documenting and free of opaque binary blobs.

#### Harness setup (parsing)

No env prelude or dynamic imports. The test file imports the module under test statically, defines a `buildWav()` helper, and calls it inline:

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCuePoints } from './wav-cue.js';

function buildWav(opts: { cueSampleOffsets: number[]; reservedEmptySlots?: number; ... }): Buffer {
  // Assembles RIFF/WAVE buffer with a cue chunk from opts.cueSampleOffsets.
  // Reserved empty slots are written as sample_offset=0 and are filtered out by readCuePoints.
  // ...
}

function writeTempWav(buf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'wav-cue-'));
  const path = join(dir, 'test.wav');
  writeFileSync(path, buf);
  return path;
}

it('returns real cue offsets in ascending order, deduped', () => {
  const wav = buildWav({ cueSampleOffsets: [44100, 88200, 44100, 132300], reservedEmptySlots: 95 });
  expect(readCuePoints(writeTempWav(wav))).toEqual([44100, 88200, 132300]);
});
```

`model12.test.ts` uses the same `buildWav()` pattern but wraps it in a `placeSong()` helper that writes multiple track files into a `<card>/MTR/<songName>/` directory tree, mirroring the on-device layout that `model12.scan()` expects.

#### Harness setup (orchestration)

The `bin/import-from-device.test.ts` orchestration test builds a minimal fake SD card in a `mkdtempSync` temp dir and injects dependencies via the `runImporter` options object:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runImporter } from './import-from-device.js';
import { markerImportedFilename } from '../src/server/import/marker.js';

function tempCard(): string {
  return mkdtempSync(join(tmpdir(), 'orch-card-'));
}

function placeOneStemFolder(card: string, songName: string, mtime: Date): string {
  const dir = join(card, 'MTR', songName);
  mkdirSync(dir, { recursive: true });
  // ... write a minimal RIFF/WAVE file at dir/01_<songName>_TR01.wav with utimesSync for mtime
  return dir;
}

it('imports a single-segment folder, writes the imported marker', async () => {
  const card = tempCard();
  placeOneStemFolder(card, '260512_0001', new Date(Date.now() - 60 * 60 * 1000));

  const cfg = {
    device: 'model12',
    sd_card_path: card,
    paperstem_url: 'https://paperstem.test',
    band_id: 'b1',
  };

  const fetchMock = vi.fn().mockImplementation((url: string, init: RequestInit) => {
    if (url === 'https://paperstem.test/api/projects' && init.method === 'POST') {
      return Promise.resolve(
        new Response(JSON.stringify({ project: { id: 'pr_new' } }), { status: 201 }),
      );
    }
    // ... handle stem upload endpoints
  });

  const result = await runImporter({
    config: cfg,
    token: 'tok',
    fetchImpl: fetchMock,
    encodeFn: async ({ outputPath }) => {
      writeFileSync(outputPath, Buffer.from('fake mp3 bytes'));
    },
  });

  expect(result.status).toBe('ok');
  const dir = join(card, 'MTR', '260512_0001');
  expect(existsSync(join(dir, markerImportedFilename))).toBe(true);
});
```

Key points:
- `fetchImpl` replaces `globalThis.fetch` for the entire orchestrator run. Route it by `url` + `init.method` and throw on unexpected URLs — this catches silent misrouting.
- `encodeFn` replaces the real ffmpeg-based MP3 encoder. Writing any non-empty buffer to `outputPath` is sufficient; the orchestrator only checks that the file exists and is non-empty before uploading.
- `mtime` must be old enough (here, one hour ago) to clear the `stillRecordingThreshold`; otherwise `model12.scan` marks the task `still-recording` and the orchestrator skips it without calling fetch.
- No env prelude needed: `runImporter` takes all dependencies as explicit parameters and does not import `db.ts` or `mailer.ts`.

#### What to assert

**Parsing tests:** assert the structured output of the parser against the exact input buffer. For `readCuePoints`: the returned array of sample offsets, its sort order, deduplication behavior, and that reserved empty slots (sample_offset=0) are filtered out. For `model12.scan`: the `tasks` array length, each `task.segment` (start/end sample, index), `task.trackPositions`, `task.recordedOn`, `task.defaultProjectName`, and `task.status.kind`.

**Orchestration tests:** assert two things after `runImporter` returns:
1. `result.status` — `'ok'`, `'no-card'`, etc.
2. The marker file on disk — `existsSync(join(dir, markerImportedFilename))` is `true`, and the parsed JSON contains the expected `project_id` and a truthy `uploaded_at` for each segment.

For skip-path tests (already-imported marker, still-recording mtime), assert `result.status === 'ok'` and `fetchMock` was never called.

#### What not to do

- **Do not construct ad-hoc byte arrays inline inside an `it` block.** Each parsing test file defines a `buildWav()` helper at the top that produces a well-formed RIFF/WAVE buffer from parameters. Use it. Inlining raw `Buffer.alloc` writes in a test body obscures intent and makes it easy to produce a malformed buffer that the function under test rejects before the assertion is ever reached.
- **Do not use real ffmpeg in orchestration tests.** `compressToMp3` is injectable via `encodeFn`. Calling the real encoder requires ffmpeg on PATH, takes ~100ms per file, and is already covered by `audio-compress-local.test.ts`. Pass an `encodeFn` stub that writes a placeholder buffer.
- **Do not omit `utimesSync` when mtime matters.** `model12.scan` uses file mtime to decide `recordedOn` and whether a task is still-recording. If you write a WAV file without setting mtime, the OS assigns the current time, which will trigger the still-recording guard and cause the orchestrator to skip the task silently.

### Server auth

This category covers the auth helpers in `src/server/auth/`. These files sit between a pure lib test and a full route-handler test: most depend on `NODE_ENV` at module-load time or exercise Hono route handlers that require a running DB.

**Canonical examples:**

- `src/server/auth/cookie.test.ts` — uses `vi.resetModules()` + `freshImport()` to test `setSessionCookie` and `SESSION_COOKIE_NAME` under both `NODE_ENV=development` and `NODE_ENV=production`. The module evaluates `NODE_ENV` when it is first imported, so a fresh module registry is required for each env variant.
- `src/server/auth/dev-login.test.ts` — auth route handler using the same Hono harness as the [route-handler category](#server-route-handlers). It additionally requires the `PAPERSTEM_DEV_AUTO_LOGIN` env var to be set/unset per test and asserts on cookie headers and DB side effects. See [Server route handlers](#server-route-handlers) for the full harness setup.
- `src/server/auth/rate-limit.test.ts` — pure class with an injectable clock. No env prelude, no DB. Covered in full under [Server libs](#server-libs); listed here because it is in the auth package.

#### The `freshImport` pattern

Use `freshImport()` whenever the module under test reads `process.env.*` or other global state at module initialisation time (i.e. at the top level, outside any function). `vi.resetModules()` discards the module registry so the next `import()` re-executes the module top level with the current env.

```typescript
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

async function freshImport() {
  vi.resetModules();
  return await import('./cookie.js');
}

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('cookie module — dev', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  it('sets the cookie without Secure flag and with HttpOnly + SameSite=Lax', async () => {
    const mod = await freshImport();
    const c = makeContext();
    mod.setSessionCookie(c, 'abc123');
    const setCookie = c._headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('paperstem_session_dev=abc123');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toContain('Secure');
  });
});
```

**When to use it:** any time a module's exported values or behavior depend on env vars (or any other process-level state) that are read at the top level of the module, not inside a function. `cookie.ts` selects its cookie name constant at init time based on `NODE_ENV`, so each `describe` block that changes `NODE_ENV` must call `freshImport()` before exercising the module.

This is distinct from a module that reads `process.env` inside a function call — that does not require `freshImport()` because the env is read at call time, not load time.

**Always restore the original env value in `afterEach`.** Capture it before any `describe` block mutates it, and restore it unconditionally (including the `undefined` case, which requires `delete` not assignment).

#### What to assert

For cookie-setting code, assert on the raw `Set-Cookie` header string rather than a parsed cookie object. Hono's `setCookie` serialises directly to the `set-cookie` header; checking the string confirms that the serialised form that browsers receive is correct:

```typescript
// From cookie.test.ts — prod case
const setCookie = c._headers.get('set-cookie') ?? '';
expect(setCookie).toContain('__Host-paperstem_session=abc123');
expect(setCookie).toContain('HttpOnly');
expect(setCookie).toContain('Secure');
expect(setCookie).toContain('SameSite=Lax');
expect(setCookie).toContain('Path=/');
```

For auth route handlers, assert on the HTTP response shape — status code, `location` header on redirects, and that `set-cookie` contains the session cookie name:

```typescript
// From dev-login.test.ts — happy path
expect(res.status).toBe(302);
expect(res.headers.get('location')).toBe('/');
const setCookie = res.headers.get('set-cookie') ?? '';
expect(setCookie).toContain(cookieMod.SESSION_COOKIE_NAME);
```

Also verify DB side effects for routes that create users or sessions:

```typescript
const user = dbMod.stmts.findUserByEmail.get('dev@example.com');
expect(user).toBeDefined();
expect(user?.email).toBe('dev@example.com');
```

#### Env-var gating on auth routes

`dev-login.test.ts` covers two guard conditions that are specific to auth routes:

```typescript
it('returns 404 when env var is unset', async () => {
  delete process.env.PAPERSTEM_DEV_AUTO_LOGIN;
  const res = await app.fetch(new Request('http://x/api/auth/dev-login'));
  expect(res.status).toBe(404);
});

it('returns 404 when NODE_ENV is production', async () => {
  process.env.PAPERSTEM_DEV_AUTO_LOGIN = 'dev@example.com';
  process.env.NODE_ENV = 'production';
  const res = await app.fetch(new Request('http://x/api/auth/dev-login'));
  expect(res.status).toBe(404);
});
```

Unlike `cookie.ts`, `dev-login.ts` reads `NODE_ENV` and `PAPERSTEM_DEV_AUTO_LOGIN` inside the handler at request time — not at module-load time — so `freshImport()` is not needed. Instead, restore both env vars in `afterEach`:

```typescript
afterEach(() => {
  if (ORIGINAL_AUTO_LOGIN === undefined) delete process.env.PAPERSTEM_DEV_AUTO_LOGIN;
  else process.env.PAPERSTEM_DEV_AUTO_LOGIN = ORIGINAL_AUTO_LOGIN;
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});
```

#### What not to do

- **Do not share module state across `describe` blocks that override `NODE_ENV`.** `cookie.ts` reads `NODE_ENV` at the top level. If two `describe` blocks test different env values using the same imported module (no `freshImport()`), they will both see the value that was current when the module was first loaded — whichever `describe` ran first wins, and the other tests silently test the wrong behavior.
- **Do not call `freshImport()` for modules that read env vars inside functions** (not at the top level). Doing so adds unnecessary overhead and obscures which modules actually have load-time env dependencies.
- **Do not skip `afterEach` env restoration.** A missing restore leaves `NODE_ENV` or `PAPERSTEM_DEV_AUTO_LOGIN` mutated for subsequent test files that run in the same vitest worker. This can cause test-ordering-dependent failures that are hard to diagnose.

#### Cross-references

- For the injectable-clock pure-function pattern used in `rate-limit.test.ts`, see [Server libs](#server-libs).
- For the full route-handler harness (env prelude, dynamic imports, `beforeAll`, `reset()`, helper factories) that `dev-login.test.ts` uses, see [Server route handlers](#server-route-handlers).

### Client components

**Canonical example:** `src/client/components/CommentList.test.tsx`. It has a focused render (no App wrapper, no provider), a factory helper (`ann()`), both tab-interaction and callback-assertion tests, and uses `getByRole`, `getByTestId`, and `getByLabelText` — covering the full query-preference hierarchy in a single file.

#### Harness setup

The client vitest project loads `src/client/test-setup.ts` automatically before any test file runs. That module installs an in-memory `localStorage` polyfill, stubs `window.confirm` to return `false`, filters happy-dom network-fetch noise, and registers `afterEach(cleanup)` so the DOM is torn down between every test. You do not need to import it or call `cleanup()` yourself.

Component tests import directly from `@testing-library/react` and the component under test:

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { CommentList } from './CommentList';

const baseProps = {
  annotations,
  selfUserId: 'u1',
  activeId: null as string | null,
  onSelect: vi.fn(),
  onToggleStar: vi.fn(),
  // ...
};

describe('CommentList', () => {
  it('renders a card per annotation', () => {
    render(<CommentList {...baseProps} />);
    expect(screen.getAllByTestId(/^list-card-/)).toHaveLength(3);
  });
});
```

No `beforeAll`, no env prelude, no dynamic imports. All state the component needs comes in through props; callbacks are `vi.fn()`.

Where props are more complex, tests define a factory helper at the top of the file rather than repeating large inline literals:

```typescript
// From CommentList.test.tsx
function ann(over: Partial<Annotation>): Annotation {
  return {
    id: 'x', project_id: 'p1', user_id: 'u1',
    user_email: 'u@example.com', user_display_name: 'Sam',
    start_ms: 0, end_ms: null, body: 'b',
    starred: false, created_at: 0, updated_at: 0,
    ...over,
  };
}

// From Track.test.tsx
function makeStem(overrides: Partial<LoadedStem> = {}): LoadedStem {
  return {
    name: 'old.wav', displayName: 'old.wav', color: '#888',
    audio: new Audio(), audioBuffer: null, userMuted: false,
    soloed: false, userVolume: 100, projectId: 'project-1',
    serverId: 'stem-1', gain: null, peaks: null,
    ...overrides,
  };
}
```

#### Query preference order

The codebase uses these queries in order of preference:

1. **`getByRole`** — first choice for interactive elements (buttons, links, textboxes, sliders, dialogs, tabs, menu items). Matches what the accessibility tree exposes. Use with `{ name: /label/i }` to disambiguate when multiple elements share a role.
2. **`getByLabelText`** — for form inputs and icon-only buttons where the accessible label is the clearest selector (e.g. `getByLabelText('Add annotation')`, `getByLabelText(/rename stem/i)`).
3. **`getByText`** — for non-interactive content: headings, counters, body text. Used when checking that specific text is rendered.
4. **`getByTestId`** — last resort. Used in this codebase for elements that have no accessible role or label and where `getByText` would be ambiguous — row anchors like `list-card-<id>`, `fp-row-<id>`, `annotation-marker-<id>`, and backdrop/scrim elements. When adding a `data-testid`, prefer it over `container.querySelector` for standard element lookups.

#### Interactions

Prefer `userEvent.setup()` + `await user.click(...)` over bare `fireEvent.click(...)` for user-initiated interactions. `userEvent` simulates the full browser event sequence (pointerdown, mousedown, focus, click, etc.) and catches bugs that `fireEvent` misses.

```typescript
import userEvent from '@testing-library/user-event';

it('clicking ＋ toggles annotation create-mode', async () => {
  const onToggle = vi.fn();
  const user = userEvent.setup();
  render(<AppToolbar {...baseProps} onToggleAnnotationCreate={onToggle} />);
  await user.click(screen.getByLabelText('Add annotation'));
  expect(onToggle).toHaveBeenCalledOnce();
});
```

`fireEvent` is used deliberately for low-level pointer and DOM events that have no `userEvent` equivalent: `fireEvent.pointerDown`, `fireEvent.pointerMove`, `fireEvent.pointerUp` for drag sequences (Playhead, Minimap), `fireEvent.error` to trigger Audio element error handlers (Track), and `fireEvent.keyDown(document, ...)` for global keyboard listeners. Do not mix `fireEvent` and `userEvent` in the same test for the same interaction path.

#### Async assertions

Two patterns appear in this codebase:

- **`await screen.findByText(...)`** — use when a component fetches data on mount and you're waiting for the result to appear in the DOM. `findByX` returns a promise that retries until the element appears or times out. Used in `TokensDrawer.test.tsx` because the drawer fetches `/api/me/tokens` on open.
- **`await waitFor(() => expect(...).toHaveBeenCalledWith(...))`** — use for state assertions where there is no element to query directly, such as waiting for a debounced or async callback to fire. Used in `AppHeader.test.tsx` for the rename flow where `onRenameProject` fires after blur/Enter.

```typescript
// findByX — waiting for rendered text after a fetch
await screen.findByText(/no import tokens/i);

// waitFor — waiting for a callback to fire
await waitFor(() => expect(onRename).toHaveBeenCalledWith('New name'));
```

If the element you're waiting for has a query equivalent, prefer `findByX` — it's shorter and clearer. Use `waitFor` only when you need to assert on a callback or state value, not a DOM element.

#### What to assert

Assert behavior that is visible to the user or observable through the component's public interface:

- **Text rendered** — `expect(screen.getByText('1 / 3')).not.toBeNull()`
- **Role state** — `expect((btn as HTMLButtonElement).disabled).toBe(true)`, `expect(icon.getAttribute('aria-expanded')).toBe('true')`
- **Callbacks fired with expected args** — `expect(onToggleStar).toHaveBeenCalledWith(annotations[0])`, `expect(onSaveEdit).toHaveBeenCalledWith(annotations[0], 'updated')`
- **Element presence/absence** — `expect(screen.queryByLabelText('Hide track controls')).toBeNull()`

The most common callback assertion is `toHaveBeenCalledOnce()` (no args check) for simple toggle buttons, and `toHaveBeenCalledWith(...)` when the argument value is the thing under test.

#### What not to do

- **Do not render `<App />` to test a leaf component.** Every test in this codebase renders the component under test directly. Components are designed to accept all data as props; wrapping in App to test a leaf is never necessary.
- **Do not use `container.querySelector` when `getByRole` or `getByLabelText` would work.** `querySelector` is used in this codebase only when querying by CSS class for visual/layout assertions (`container.querySelector('.track')?.classList.contains('tier-min')`) or for elements with no role/label that have no `data-testid` (e.g. `container.querySelector('.minimap-rect')`). For buttons, inputs, and labeled elements, always prefer a role or label query.
- **Do not mix `fireEvent` and `userEvent` in the same test for the same interaction path.** Use `userEvent.setup()` + `await user.*` for user-initiated clicks, types, and keyboard input. Reserve `fireEvent` for low-level pointer sequences and DOM events that have no `userEvent` equivalent.
- **Do not assert on class names as a proxy for behavior when a role or callback assertion exists.** The `tier-*` class tests in `Track.test.tsx` are an acceptable exception because they specifically test layout-tier CSS logic. For most behavior (disabled state, visibility, callback arguments), query the accessible state or the callback directly.
