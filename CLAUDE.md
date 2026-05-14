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

A worktree by default uses `./dev.sqlite` (its own empty DB). To share users/sessions/projects with the main checkout, point at its DB:

```bash
DATABASE_PATH=/Users/zachkysar/projects/paperstem/dev.sqlite ...
```

The session cookie survives a server restart because sessions are DB-backed.

### Skipping the magic-link flow in dev

Set `PAPERSTEM_DEV_AUTO_LOGIN=<email>` and the launcher prints a `Dev login:` URL
under the UI/API lines. Hitting `${UI}/api/auth/dev-login` mints a session for
that email (creating the user if missing) and 302s to `/`. The route is only
registered when `NODE_ENV !== 'production'` and the env var is set.

## Local-folder Drive backend (dev)

`npm run dev` defaults `PAPERSTEM_LOCAL_DRIVE_ROOT` to `${cwd}/drive-dev` (and `mkdir -p`s it) so dev never touches real Google Drive by accident. The launcher prints `Drive: local folder ...` in its header. To opt back into real Drive — e.g. when reproducing a Drive-specific bug — explicitly set the var to empty: `PAPERSTEM_LOCAL_DRIVE_ROOT= npm run dev` (header will show `Drive: GOOGLE`).

When set, every Drive op (`createFolder`, `uploadFile`, `getDriveFile`, `listFolder`, `find*`, `deleteFile`, `updateFile`) reads/writes under that root. IDs become `local:<base64url(relpath)>`. HTTP Range is honored, so audio seeking works.

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

A pre-push hook in [scripts/git-hooks/pre-push](scripts/git-hooks/pre-push) runs `npm run build` and `vitest` before any push and blocks if either fails (matches CI). It also refuses direct pushes to `main` — open a PR instead (see below). New checkouts must opt in once: `git config core.hooksPath scripts/git-hooks`. Bypass with `git push --no-verify`.

## Shipping changes — PRs only

**Do not merge work into `main` locally and push.** Every change lands through a GitHub PR, even tiny ones. `main` has branch protection requiring a PR; the local pre-push hook also refuses direct `main` pushes. This keeps history reviewable and CI honest.

Workflow when finishing a piece of work:

1. Push the worktree/feature branch: `git push -u origin <branch>`.
2. Open a PR against `main` with `gh pr create`.
3. Merge from the PR (`gh pr merge --squash` or via the UI), then delete the branch.

Don't `git checkout main && git merge <branch> && git push` — the hook will block it and that's intentional. If you genuinely need to bypass (rare; e.g. recovering a broken remote), use `--no-verify` and say so explicitly.

## Deployment

Two Fly.io apps, deployed by [.github/workflows/ci.yml](.github/workflows/ci.yml):

| App | Config | Trigger |
|---|---|---|
| `paperstem-dev` (https://paperstem-dev.fly.dev) | [fly.dev.toml](fly.dev.toml) | every push to `main` |
| `paperstem` (https://paperstem.fly.dev) | [fly.toml](fly.toml) | tag push matching `v*` (e.g. `git tag v1.2.3 && git push origin v1.2.3`) |

Both use the same [Dockerfile](Dockerfile). The `APP_VERSION` build arg is baked in as an env var; the server returns it from `/api/version` and the client renders it in the avatar dropdown. Dev builds get `dev-<short-sha>`, prod builds get the tag name (`v1.2.3`).

### One-time setup

```bash
# Dev app + volume
fly apps create paperstem-dev
fly volumes create paperstem_dev_data --region sjc --size 1 -a paperstem-dev

# Secrets — both apps need GMAIL_* (mailer.ts crashes at import without them)
# and GOOGLE_* (Drive API). Repeat for -a paperstem.
# BUG_REPORT_TO is optional — bug-report emails are sent to GMAIL_USER if
# unset. Set it to redirect them to a different inbox.
fly secrets set -a paperstem-dev \
  GMAIL_USER=... GMAIL_APP_PASSWORD=... \
  GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... \
  BUG_REPORT_TO=...

# GitHub Actions token (one token works for both apps)
fly tokens create deploy -x 999999h
# Add the output as repo secret FLY_API_TOKEN at:
# https://github.com/<owner>/paperstem/settings/secrets/actions
```

## Things that bite

- **`mailer.ts` throws at module import** if `GMAIL_USER`/`GMAIL_APP_PASSWORD` aren't set. Use placeholders in dev unless you actually need to send a magic link.
- **`tsx watch` swallows the first stack trace** sometimes — if the server seems silently dead, kill and run without `watch` to see the real error.
- **Vite SPA fallback** serves `index.html` for unknown HTML routes; static debug pages in `src/client/` won't load unless registered as inputs.
- **Worktree-versus-main config drift**: if you start Vite or the server from the wrong directory, you'll be running the wrong branch's config. Check `ps -p <pid> -o command` to confirm which checkout the running process belongs to.
