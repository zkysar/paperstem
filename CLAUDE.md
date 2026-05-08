# Paperstem

Notes for Claude — kept terse. Read [README.md](README.md) for product context.

## Architecture in one paragraph

Two-process app. **Hono server** ([src/server/](src/server/)) on default port `8787` serves the API and, in prod, the built client. Storage: **SQLite** at `./dev.sqlite` (path overridable via `DATABASE_PATH`), audio in **Google Drive** (or a local folder in dev — see below). **Vite + React** ([src/client/](src/client/)) on default port `5173`, proxies `/api/*` and `/auth/callback` to the API. Magic-link auth → DB-backed sessions in a cookie. Tests: `vitest`, split into client + server projects.

## Running locally — single checkout

```bash
# terminal 1
GMAIL_USER=… GMAIL_APP_PASSWORD=… npx tsx watch src/server/index.ts

# terminal 2
npx vite
```

Open http://localhost:5173. `GMAIL_*` are required at server boot even if you don't intend to send mail; placeholders are fine if you already have a session cookie.

## Running in a worktree alongside the main checkout

The default ports (`5173` Vite, `8787` API) belong to the main checkout. **Never reuse them from a worktree** — pick a unique offset and stick to it for that worktree's lifetime.

Both ports are env-driven:

| Var | Default | What it does |
|---|---|---|
| `PORT` | `8787` | Hono API listen port |
| `PAPERSTEM_VITE_PORT` | `5173` | Vite dev server port |
| `PAPERSTEM_API_PORT` | `8787` | Where Vite's `/api` and `/auth/callback` proxy points |

`PAPERSTEM_API_PORT` must match `PORT` — otherwise the UI talks to the wrong server.

Recipe for a second checkout:

```bash
# pick a unique offset, e.g. +1
PORT=8788 \
PAPERSTEM_VITE_PORT=5174 \
PAPERSTEM_API_PORT=8788 \
DATABASE_PATH=$(pwd)/dev.sqlite \
PAPERSTEM_LOCAL_DRIVE_ROOT=$(pwd)/drive-dev \
GMAIL_USER=x GMAIL_APP_PASSWORD=x \
npx tsx watch src/server/index.ts
```

```bash
PAPERSTEM_VITE_PORT=5174 PAPERSTEM_API_PORT=8788 npx vite
```

Open http://localhost:5174. Convention: use `+1` for the first worktree, `+2` for the second, etc. **Verify with `lsof -i :<port>` before starting** — port collisions silently fail in confusing ways (Vite picks the next free port and the proxy aims at the wrong API).

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

## Things that bite

- **`mailer.ts` throws at module import** if `GMAIL_USER`/`GMAIL_APP_PASSWORD` aren't set. Use placeholders in dev unless you actually need to send a magic link.
- **`tsx watch` swallows the first stack trace** sometimes — if the server seems silently dead, kill and run without `watch` to see the real error.
- **Vite SPA fallback** serves `index.html` for unknown HTML routes; static debug pages in `src/client/` won't load unless registered as inputs.
- **Worktree-versus-main config drift**: if you start Vite or the server from the wrong directory, you'll be running the wrong branch's config. Check `ps -p <pid> -o command` to confirm which checkout the running process belongs to.
