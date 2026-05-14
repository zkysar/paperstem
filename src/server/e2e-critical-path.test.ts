/**
 * End-to-end smoke test: login -> audio-load critical path.
 *
 * Scope: server-only (no browser). Spins up Hono in-process, exercises the
 * dev-login route to mint a real session cookie, then GETs /api/audio/:stem_id
 * with that cookie. Fails if anything in the login -> session -> membership-
 * check -> file-serve chain is broken.
 *
 * Lives next to audio.ts (the code it exercises most directly). A separate
 * __e2e__ folder would be appropriate if more cross-cutting tests accumulate,
 * but one file does not justify the indirection.
 */

import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

// ---- env prelude (must happen before any import of db.ts / mailer.ts / storage.ts) ----
const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-e2e-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
const audioRoot = join(tmpDir, 'audio');
mkdirSync(audioRoot, { recursive: true });
process.env.DATABASE_PATH = dbPath;
process.env.PAPERSTEM_AUDIO_ROOT = audioRoot;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';
process.env.PAPERSTEM_DEV_AUTO_LOGIN = 'e2e@paperstem.test';
process.env.NODE_ENV = 'test'; // not 'production'; dev-login must be enabled

// ---- module type aliases ----
type DbModule = typeof import('./db.js');
type DevLoginModule = typeof import('./auth/dev-login.js');
type AudioModule = typeof import('./audio.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let devLoginMod: DevLoginModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

function encodeId(rel: string): string {
  return Buffer.from(rel, 'utf8').toString('base64url');
}

beforeAll(async () => {
  dbMod = await import('./db.js');
  devLoginMod = await import('./auth/dev-login.js');
  const audioMod: AudioModule = await import('./audio.js');
  const middlewareMod: MiddlewareModule = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');

  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  // dev-login route — same guard the real server uses
  app.get('/api/auth/dev-login', devLoginMod.handleDevLogin);
  app.get('/api/audio/:stem_id', audioMod.handleGetAudio);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  dbMod.db.exec(
    'DELETE FROM stems; DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
  rmSync(audioRoot, { recursive: true, force: true });
  mkdirSync(audioRoot, { recursive: true });
}

beforeEach(() => {
  reset();
});

it('login -> audio-load: session cookie grants audio bytes for a band member stem', async () => {
  const now = Math.floor(Date.now() / 1000);
  const bandName = 'TestBand';
  const projectName = 'TestProject';

  // ---- seed DB: band + membership ----
  const bandId = randomUUID();
  // The user will be created by dev-login; we need the band to exist first.
  // Insert a placeholder owner so the foreign-key constraint is satisfied, then
  // add the dev-login user as a member after login mints the user row.
  const ownerId = randomUUID();
  dbMod.stmts.insertUser.run(ownerId, 'owner@paperstem.test', null, now);
  dbMod.stmts.insertBand.run(bandId, bandName, encodeId(bandName), ownerId, now);
  dbMod.stmts.insertMembership.run(bandId, ownerId, 'owner', now);

  // ---- seed disk: band folder / project folder / stem file ----
  const bandDir = join(audioRoot, bandName);
  const projectDir = join(bandDir, projectName);
  mkdirSync(projectDir, { recursive: true });

  const stemFileName = 'guitar.mp3';
  const stemContent = Buffer.from('fake-mp3-bytes-for-e2e-test');
  const stemFilePath = join(projectDir, stemFileName);
  writeFileSync(stemFilePath, stemContent);

  // file_id is the base64url of the relative path under audioRoot
  const fileId = encodeId(`${bandName}/${projectName}/${stemFileName}`);

  // ---- seed DB: project + stem ----
  const projectId = randomUUID();
  const folderId = encodeId(`${bandName}/${projectName}`);
  dbMod.stmts.insertProject.run(
    projectId,
    bandId,
    projectName,
    null,
    folderId,
    null,
    now,
    ownerId,
    now,
  );

  const stemId = randomUUID();
  dbMod.stmts.insertStem.run(stemId, projectId, stemFileName, 0, fileId, null, stemContent.length, null);

  // ---- hit dev-login to mint a session for the configured email ----
  const loginRes = await app.fetch(new Request('http://x/api/auth/dev-login'));
  expect(loginRes.status, 'dev-login should redirect').toBe(302);

  // Extract Set-Cookie header and turn it into a Cookie request header
  const setCookie = loginRes.headers.get('set-cookie') ?? '';
  expect(setCookie, 'dev-login should set a session cookie').toContain(
    cookieMod.SESSION_COOKIE_NAME,
  );

  // Parse out the cookie value: "name=value; ..."
  const cookiePair = setCookie.split(';')[0].trim(); // e.g. "paperstem_session_dev=abc123"

  // ---- add the dev-login user as a band member so the audio gate passes ----
  const devUser = dbMod.stmts.findUserByEmail.get('e2e@paperstem.test');
  expect(devUser, 'dev-login should have created the user row').toBeDefined();
  dbMod.stmts.insertMembership.run(bandId, devUser!.id, 'member', now);

  // ---- fetch audio with the session cookie ----
  const audioRes = await app.fetch(
    new Request(`http://x/api/audio/${stemId}`, {
      headers: { Cookie: cookiePair },
    }),
  );

  expect(audioRes.status, 'audio endpoint should return 200').toBe(200);

  const contentType = audioRes.headers.get('content-type') ?? '';
  expect(contentType, 'content-type should be audio/*').toMatch(/^audio\//);

  const body = await audioRes.arrayBuffer();
  expect(body.byteLength, 'audio response should contain bytes').toBeGreaterThan(0);
  expect(
    Buffer.from(body).toString(),
    'returned bytes should match what was written',
  ).toBe(stemContent.toString());
});
