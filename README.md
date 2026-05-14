# Paperstem

A DAW-style stem player for sharing rough mixes with bandmates.

**Production:** https://paperstem.fly.dev (login required)

## UI

A Google-Docs-style shell: an `AppHeader` (brand · ▦ files · project title · Drive ↗ · 💬 comments · avatar), a flat `AppToolbar` (transport · download · waveform-scale · annotation-create · marker visibility · master volume · time), and the song timeline below. The project list lives behind `⌘K` / the ▦ button as a `FilePicker` overlay rather than a persistent sidebar; comments open in a right-side push column. See `~/projects/plans/2026-05-07-paperstem-ui-redesign.md` for the full design.

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

## Importing from a multitrack recorder

Paperstem ships a CLI importer that pulls recordings off an SD card and turns them into projects automatically. Currently supports the Tascam Model 12; other multitrack recorders can be added as plugins under [src/server/import/](src/server/import/).

### Workflow

On the device:

1. Once per project, create a new song on the Model 12 and start recording.
2. (Optional) Tap **MARK** at the start of each new idea you want as a separate project in Paperstem.
3. Press **STOP** when done.

On your laptop:

1. Insert the SD card (or connect the Model 12 over USB-C in mass-storage mode).
2. The launchd agent (set up once, below) notices it and uploads everything within ~5 minutes. New projects appear in Paperstem with the song name for un-marked songs, or `take 1` / `take 2` / … for marked ones.

### One-time setup

1. **Install ffmpeg:** `brew install ffmpeg`
2. **Mint a token:** Log into Paperstem → avatar menu → **Import tokens** → **Create new token**. Copy the value (shown once only).
3. **Stash the token** in macOS Keychain (or wherever you keep secrets):
   ```bash
   security add-generic-password -a "$USER" -s paperstem-import-token -w
   # paste the token when prompted
   ```
4. **Write the config** at `~/.config/paperstem/import.json`:
   ```json
   {
     "device": "model12",
     "sd_card_path": "/Volumes/YOUR_SD_CARD_NAME",
     "paperstem_url": "https://paperstem.fly.dev",
     "band_id": "band_xxxxxxxx",
     "delete_after_import": false
   }
   ```
5. **Test it once:**
   ```bash
   PAPERSTEM_SESSION_TOKEN="$(security find-generic-password -a "$USER" -s paperstem-import-token -w)" \
     npx tsx bin/import-from-device.ts
   ```
   No SD card mounted? Silent exit. Card with new recordings? They land in Paperstem.
6. **Schedule it** with `~/Library/LaunchAgents/com.you.paperstem-import.plist`:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>Label</key><string>com.you.paperstem-import</string>
     <key>ProgramArguments</key>
     <array>
       <string>/opt/homebrew/bin/npx</string>
       <string>tsx</string>
       <string>/Users/you/projects/paperstem/bin/import-from-device.ts</string>
     </array>
     <key>EnvironmentVariables</key>
     <dict>
       <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
       <key>PAPERSTEM_SESSION_TOKEN</key><string><!-- paste your token --></string>
     </dict>
     <key>StartInterval</key><integer>300</integer>
     <key>StandardOutPath</key><string>/tmp/paperstem-import.out</string>
     <key>StandardErrorPath</key><string>/tmp/paperstem-import.err</string>
   </dict>
   </plist>
   ```
   Load with `launchctl load -w ~/Library/LaunchAgents/com.you.paperstem-import.plist`.

### Permissions

The importer creates projects via `POST /api/projects`, which is currently restricted to the **band owner**. Non-owner members can't use the importer against a band they don't own — the API returns 403. If you're not the owner of the `band_id` in your config, ask the owner to mint a token for you and stash it locally, or relax the route to any member (`src/server/projects.ts:239`).

### Reclaiming SD card space

By default, the importer never deletes files from the card. To enable automatic deletion after a successful import, set `"delete_after_import": true` in the config — that waits 30 days before deletion so you have time to spot a bad upload and `rm` the `.paperstem-imported` marker to re-import. Pass an integer to override the grace period in days, or `0` to delete on the next tick.

## Deploying

```bash
flyctl deploy --app paperstem
```

The Fly machine builds the Docker image remotely on linux/amd64. Secrets (`GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `SESSION_COOKIE_SECRET`) are set via `flyctl secrets set`.

## History

Originally hosted on GitHub Pages as a static demo with a JSON-backed project list and gitignored audio. Migrated to Fly.io with the React + Hono + SQLite + Drive architecture above; GH Pages decommissioned in Phase 7.
