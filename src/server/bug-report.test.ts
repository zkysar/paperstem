import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-bug-report-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

const sendBugReportMock = vi.fn().mockResolvedValue(undefined);

vi.mock('./mailer.js', async () => {
  const actual = await vi.importActual<typeof import('./mailer.js')>('./mailer.js');
  return {
    ...actual,
    sendBugReport: (...args: unknown[]) => sendBugReportMock(...args),
  };
});

type DbModule = typeof import('./db.js');
type BugReportModule = typeof import('./bug-report.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let bugMod: BugReportModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  bugMod = await import('./bug-report.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.post('/api/bug-report', bugMod.handleBugReport);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  dbMod.db.exec(
    'DELETE FROM annotations; DELETE FROM stems; DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
  sendBugReportMock.mockClear();
  bugMod.bugReportLimiter.reset();
}

function createUser(email: string): string {
  const id = randomUUID();
  dbMod.stmts.insertUser.run(id, email, null, Math.floor(Date.now() / 1000));
  return id;
}

function createSession(userId: string): string {
  const sid = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertSession.run(sid, userId, now + 3600, now);
  return sid;
}

// 1×1 transparent PNG (real signature so decodeScreenshot accepts it).
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwAFBAIAX8jx0gAAAABJRU5ErkJggg==';

function authHeader(sid: string): Record<string, string> {
  return { cookie: `${cookieMod.SESSION_COOKIE_NAME}=${sid}` };
}

function basePayload() {
  return {
    description: 'the player crashed when I clicked play',
    url: 'http://localhost:5173/project/abc',
    viewport: { w: 1280, h: 800 },
    userAgent: 'Mozilla/5.0 (test)',
    pageContext: { page: 'player', projectId: 'abc', stems: 4 },
    recentErrors: [
      { ts: '2026-05-11T22:53:51.000Z', message: 'TypeError: foo', stack: 'at A\n  at B' },
    ],
    appVersion: 'v0.2.1',
  };
}

beforeEach(reset);

describe('POST /api/bug-report', () => {
  it('returns 401 without a session', async () => {
    const res = await app.request('/api/bug-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(basePayload()),
    });
    expect(res.status).toBe(401);
    expect(sendBugReportMock).not.toHaveBeenCalled();
  });

  it('returns 400 when description is missing', async () => {
    const userId = createUser('zach@example.com');
    const sid = createSession(userId);
    const body = basePayload() as Partial<ReturnType<typeof basePayload>>;
    delete body.description;
    const res = await app.request('/api/bug-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(sid) },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    expect(sendBugReportMock).not.toHaveBeenCalled();
  });

  it('returns 400 when description is only whitespace', async () => {
    const userId = createUser('zach@example.com');
    const sid = createSession(userId);
    const body = { ...basePayload(), description: '   \n   ' };
    const res = await app.request('/api/bug-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(sid) },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 and calls the mailer for a valid report (no screenshot)', async () => {
    const userId = createUser('zach@example.com');
    const sid = createSession(userId);
    const res = await app.request('/api/bug-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(sid) },
      body: JSON.stringify(basePayload()),
    });
    expect(res.status).toBe(200);
    expect(sendBugReportMock).toHaveBeenCalledOnce();
    const [arg] = sendBugReportMock.mock.calls[0]!;
    expect(arg.reporterEmail).toBe('zach@example.com');
    expect(arg.reporterUserId).toBe(userId);
    expect(arg.description).toContain('player crashed');
    expect(arg.screenshotPng).toBeUndefined();
    expect(arg.appVersionUrl).toBe('https://github.com/zkysar/paperstem/tree/v0.2.1');
  });

  it('decodes a base64 screenshot and passes a Buffer to the mailer', async () => {
    const userId = createUser('zach@example.com');
    const sid = createSession(userId);
    const body = { ...basePayload(), screenshotBase64: TINY_PNG_BASE64 };
    const res = await app.request('/api/bug-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(sid) },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const [arg] = sendBugReportMock.mock.calls[0]!;
    expect(Buffer.isBuffer(arg.screenshotPng)).toBe(true);
    expect(arg.screenshotPng.length).toBeGreaterThan(0);
  });

  it('rejects a screenshot that is not a PNG', async () => {
    const userId = createUser('zach@example.com');
    const sid = createSession(userId);
    const body = { ...basePayload(), screenshotBase64: Buffer.from('not a png').toString('base64') };
    const res = await app.request('/api/bug-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(sid) },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
  });

  it('rate-limits after 5 reports per hour from the same user', async () => {
    const userId = createUser('zach@example.com');
    const sid = createSession(userId);

    for (let i = 0; i < 5; i++) {
      const res = await app.request('/api/bug-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sid) },
        body: JSON.stringify(basePayload()),
      });
      expect(res.status).toBe(200);
    }

    const res = await app.request('/api/bug-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(sid) },
      body: JSON.stringify(basePayload()),
    });
    expect(res.status).toBe(429);
    expect(sendBugReportMock).toHaveBeenCalledTimes(5);
  });

  it('returns 500 when the mailer throws', async () => {
    sendBugReportMock.mockRejectedValueOnce(new Error('smtp down'));
    const userId = createUser('zach@example.com');
    const sid = createSession(userId);
    const res = await app.request('/api/bug-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(sid) },
      body: JSON.stringify(basePayload()),
    });
    expect(res.status).toBe(500);
  });
});
