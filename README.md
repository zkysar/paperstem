# Paperstem

A DAW-style stem player for sharing rough mixes with bandmates.

**Production:** https://paperstem.fly.dev (login required)

## Architecture

- **Frontend**: Vite + React + TypeScript + WaveSurfer (`src/client/`)
- **Backend**: Hono on Node, SQLite-on-volume (`src/server/`)
- **Audio**: stems live in Google Drive (OAuth-as-me); the server streams them via a Range-supported `/api/audio/:id` proxy
- **Auth**: magic link via Gmail SMTP, `__Host-` session cookie, 30-day expiry
- **Backups**: daily per-project annotation snapshot to Drive, weekly per-band SQLite dump (8-week retention)
- **Hosting**: a single always-on Fly.io machine in `sjc`, ~$3/mo

See `~/projects/plans/2026-05-04-paperstem-deployment-design.md` for the full design.

## Local development

```bash
# Two terminals:
npm run dev          # Vite on :5173
npm run dev:server   # Hono on :8787 (pulls Gmail + Google secrets from Keychain)
```

Vite proxies `/api/*` and `/auth/*` to the Hono server. Visit http://localhost:5173.

You'll need a user row to log in: `npm run add-user -- --email you@example.com`.

## Production tooling

```bash
# Onboard a band (creates DB rows, optionally sends invite mails)
flyctl ssh console --app paperstem --command 'node /app/dist/server/bin/onboard-band.js --name "..." --owner-email "..." --member-emails "..."'

# Backfill a band's Drive folder (creates and shares with members silently)
flyctl ssh console --app paperstem --command 'node /app/dist/server/bin/backfill-band-folder.js --band-id <uuid>'

# Manually trigger backup or snapshot job (mostly for verification)
flyctl ssh console --app paperstem --command 'node /app/dist/server/bin/run-job.js [snapshots|backups]'
```

## Deploying

```bash
flyctl deploy --app paperstem
```

The Fly machine builds the Docker image remotely on linux/amd64. Secrets (`GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `SESSION_COOKIE_SECRET`) are set via `flyctl secrets set`.

## History

Originally hosted on GitHub Pages as a static demo with a JSON-backed project list and gitignored audio. Migrated to Fly.io with the React + Hono + SQLite + Drive architecture above; GH Pages decommissioned in Phase 7.
