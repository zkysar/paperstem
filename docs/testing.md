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

- Server route handlers
- Server libs
- Server migrations
- Server jobs
- Server import
- Server auth
- Client components
- Client hooks
- Client libs
- Bin scripts
