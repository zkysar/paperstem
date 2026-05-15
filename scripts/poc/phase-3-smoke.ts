// Phase 3 end-to-end smoke check for POST /api/projects/:id/classify.
//
// Boots the server's Hono app against a temp SQLite DB, seeds a user +
// band + project, then POSTs a fabricated ClassifiedSegment[] (with chroma
// on the music segment) against an empty band corpus. Verifies:
//   - 200 response with run_id + sections array
//   - source='auto', segment_type set, run_id matches on persisted rows
//   - classification_runs row marked 'done'
//
// Run with:
//   GMAIL_USER=x GMAIL_APP_PASSWORD=y npx tsx scripts/poc/phase-3-smoke.ts
//
// Output (the JSON dump at the end) is captured to phase-3-smoke.out.json.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-phase3-smoke-'));
const audioRoot = join(tmpDir, 'audio');
mkdirSync(audioRoot, { recursive: true });
process.env.DATABASE_PATH = join(tmpDir, 'smoke.sqlite');
process.env.PAPERSTEM_AUDIO_ROOT = audioRoot;
process.env.GMAIL_USER ??= 'smoke@example.com';
process.env.GMAIL_APP_PASSWORD ??= 'smoke-pass';

const dbMod = await import('../../src/server/db.js');
const routesMod = await import('../../src/server/auto-classify/routes.js');
const middlewareMod = await import('../../src/server/auth/middleware.js');
const cookieMod = await import('../../src/server/auth/cookie.js');
const { Hono } = await import('hono');

const app = new Hono();
app.use('*', middlewareMod.sessionMiddleware);
app.post('/api/projects/:id/classify', routesMod.handleClassifyProject);

const nowSec = Math.floor(Date.now() / 1000);
const userId = randomUUID();
dbMod.stmts.insertUser.run(userId, 'smoke@example.com', null, nowSec);

const bandId = randomUUID();
dbMod.stmts.insertBand.run(
  bandId,
  'Smoke Band',
  Buffer.from('Smoke Band', 'utf8').toString('base64url'),
  userId,
  nowSec,
);
dbMod.stmts.insertMembership.run(bandId, userId, 'owner', nowSec);

const projectId = randomUUID();
dbMod.stmts.insertProject.run(
  projectId,
  bandId,
  'Smoke Project',
  null,
  Buffer.from(`${bandId}/smoke`, 'utf8').toString('base64url'),
  null,
  nowSec,
  userId,
  nowSec,
);

const sessionId = randomUUID();
dbMod.stmts.insertSession.run(sessionId, userId, nowSec + 3600, nowSec);

const oneC = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const chroma = Array(40).fill(oneC);

const body = {
  audio_hash: 'sha256-smoke-fixture',
  classifier_version: 'yamnet-v1',
  fingerprint_version: 1,
  source_surface: 'web' as const,
  segments: [
    {
      start_ms: 0,
      end_ms: 4000,
      segment_type: 'music' as const,
      top_classes: [{ name: 'Music', score: 0.92 }],
      chroma,
    },
    {
      start_ms: 4000,
      end_ms: 8000,
      segment_type: 'chatter' as const,
      top_classes: [{ name: 'Speech', score: 0.81 }],
    },
    {
      start_ms: 8000,
      end_ms: 12000,
      segment_type: 'silence' as const,
      top_classes: [{ name: 'Silence', score: 0.99 }],
    },
  ],
};

const res = await app.fetch(
  new Request(`http://localhost/api/projects/${projectId}/classify`, {
    method: 'POST',
    headers: {
      Cookie: `${cookieMod.SESSION_COOKIE_NAME}=${sessionId}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }),
);

const responseJson = (await res.json()) as {
  run_id: string;
  reused: boolean;
  sections: unknown[];
};

const persisted = dbMod.db
  .prepare(
    `SELECT id, start_ms, source, run_id, segment_type, label, song_id,
            confidence, top_classes_json
       FROM sections WHERE project_id = ? ORDER BY start_ms`,
  )
  .all(projectId);

const run = dbMod.db
  .prepare('SELECT id, status, completed_at, error FROM classification_runs WHERE id = ?')
  .get(responseJson.run_id);

const summary = {
  http_status: res.status,
  response: responseJson,
  persisted_sections: persisted,
  classification_run_row: run,
};

const outPath = join(import.meta.dirname ?? '.', 'phase-3-smoke.out.json');
writeFileSync(outPath, JSON.stringify(summary, null, 2));
console.log('wrote', outPath);
console.log(JSON.stringify(summary, null, 2));

// Light assertions so this script can be wired into CI later if useful.
if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
if (responseJson.sections.length !== 2) {
  throw new Error(`expected 2 sections, got ${responseJson.sections.length}`);
}
if (!persisted.every((r) => (r as { source: string }).source === 'auto')) {
  throw new Error('expected all persisted rows to have source=auto');
}
if ((run as { status: string }).status !== 'done') {
  throw new Error(`expected run.status=done, got ${(run as { status: string }).status}`);
}
console.log('Phase 3 smoke OK');
process.exit(0);
