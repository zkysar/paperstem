# Paperstem

Notes for Claude — kept terse. Read [README.md](README.md) for product context.

## Architecture in one paragraph

Two-process app. **Hono server** ([src/server/](src/server/)) on default port `8787` serves the API and, in prod, the built client. Storage: **SQLite** at `./dev.sqlite` (path overridable via `DATABASE_PATH`), audio in **Google Drive** (or a local folder in dev — see below). **Vite + React** ([src/client/](src/client/)) on default port `5173`, proxies `/api/*` and `/auth/callback` to the API. Magic-link auth → DB-backed sessions in a cookie. Tests: `vitest`, split into client + server projects.

## Running locally

```bash
npm run dev
```

That's it. The launcher ([bin/dev.ts](bin/dev.ts)) picks two free ports from the OS, wires them through env, and spawns both the API server and Vite. **Each invocation gets fresh random ports**, so multiple worktrees can run side-by-side without collision and without a port-offset convention to remember. The first lines of output are:

```
  paperstem dev
    UI:  http://localhost:58679
    API: http://localhost:58678
```

Open the UI URL the launcher prints. Don't hardcode `5173` or `8787` in your head — read the printed URLs each time.

`with-secrets.sh` runs in front of the launcher and pulls `GMAIL_*` / `GOOGLE_*` from macOS Keychain, so secrets never live in env files or shell history.

The relevant env knobs (set automatically by the launcher; only override if you want a fixed port):

| Var | What it does |
|---|---|
| `PORT` | Hono API listen port |
| `PAPERSTEM_VITE_PORT` | Vite dev server port |
| `PAPERSTEM_API_PORT` | Where Vite's `/api` and `/auth/callback` proxy points (must match `PORT`) |

`npm run dev:client` and `npm run dev:server` are still available for running one process in isolation.

### Sharing state with the main checkout

A worktree by default uses `./dev.sqlite` (its own empty DB). To share users/sessions/practices with the main checkout, point at its DB:

```bash
DATABASE_PATH=/Users/zachkysar/projects/paperstem/dev.sqlite ...
```

The session cookie survives a server restart because sessions are DB-backed.

## Local-folder Drive backend (dev)

Setting `PAPERSTEM_LOCAL_DRIVE_ROOT` swaps Google Drive for a local directory — every Drive op (`createFolder`, `uploadFile`, `getDriveFile`, `listFolder`, `find*`, `deleteFile`, `updateFile`) reads/writes under that root. IDs become `local:<base64url(relpath)>`. HTTP Range is honored, so audio seeking works.

After setting the env var for a fresh DB (or one whose bands have placeholder/`PENDING_*` `drive_folder_id` values):

```bash
PAPERSTEM_LOCAL_DRIVE_ROOT=$(pwd)/drive-dev \
DATABASE_PATH=$(pwd)/dev.sqlite \
npx tsx bin/init-local-drive.ts
```

Walks `bands` and points each at a real local folder. Skips already-`local:` rows unless `--force`.

## Verifying changes

- `npx vitest run` — all 93+ tests, ~3s.
- `npx tsc --noEmit` — typecheck.
- For UI changes, refresh http://localhost:<vite-port> and exercise the feature. Don't claim a UI fix is done without loading it in a browser.

A pre-push hook in [scripts/git-hooks/pre-push](scripts/git-hooks/pre-push) runs `npm run build` and `vitest` before any push and blocks if either fails (matches CI). New checkouts must opt in once: `git config core.hooksPath scripts/git-hooks`. Bypass with `git push --no-verify`.

## Things that bite

- **`mailer.ts` throws at module import** if `GMAIL_USER`/`GMAIL_APP_PASSWORD` aren't set. Use placeholders in dev unless you actually need to send a magic link.
- **`tsx watch` swallows the first stack trace** sometimes — if the server seems silently dead, kill and run without `watch` to see the real error.
- **Vite SPA fallback** serves `index.html` for unknown HTML routes; static debug pages in `src/client/` won't load unless registered as inputs.
- **Worktree-versus-main config drift**: if you start Vite or the server from the wrong directory, you'll be running the wrong branch's config. Check `ps -p <pid> -o command` to confirm which checkout the running process belongs to.
