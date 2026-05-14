import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-request-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

vi.mock('../mailer.js', () => ({
  sendMagicLink: vi.fn(async () => undefined),
}));

import { sendMagicLink } from '../mailer.js';
const mockedSendMagicLink = vi.mocked(sendMagicLink);

type DbModule = typeof import('../db.js');
type RequestModule = typeof import('./request.js');
type RateLimitModule = typeof import('./rate-limit.js');

let dbMod: DbModule;
let requestMod: RequestModule;
let rateLimitMod: RateLimitModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('../db.js');
  requestMod = await import('./request.js');
  rateLimitMod = await import('./rate-limit.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.post('/api/auth/request', requestMod.handleAuthRequest);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function createUser(email: string): string {
  const id = randomUUID();
  dbMod.stmts.insertUser.run(id, email, null, Math.floor(Date.now() / 1000));
  return id;
}

function reset() {
  dbMod.db.exec('DELETE FROM magic_links; DELETE FROM users;');
  mockedSendMagicLink.mockClear();
  rateLimitMod.authRequestLimiter.reset();
}

beforeEach(reset);

async function postRequest(body: unknown): Promise<Response> {
  return app.request('/api/auth/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('handleAuthRequest', () => {
  it('returns { ok: true } with no email field — no DB write, no mailer call', async () => {
    const res = await postRequest({});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const count = (
      dbMod.db.prepare('SELECT COUNT(*) as n FROM magic_links').get() as { n: number }
    ).n;
    expect(count).toBe(0);
    expect(mockedSendMagicLink).not.toHaveBeenCalled();
  });

  it('returns { ok: true } for an unknown email — no DB write', async () => {
    const res = await postRequest({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const count = (
      dbMod.db.prepare('SELECT COUNT(*) as n FROM magic_links').get() as { n: number }
    ).n;
    expect(count).toBe(0);
    expect(mockedSendMagicLink).not.toHaveBeenCalled();
  });

  it('returns { ok: true } for a valid email and inserts a magic_links row with expires_at ~now+900', async () => {
    createUser('user@example.com');
    const nowSec = Math.floor(Date.now() / 1000);

    const res = await postRequest({ email: 'user@example.com' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const row = dbMod.db
      .prepare('SELECT token, expires_at FROM magic_links WHERE email = ?')
      .get('user@example.com') as { token: string; expires_at: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.expires_at).toBeGreaterThanOrEqual(nowSec + 895);
    expect(row!.expires_at).toBeLessThanOrEqual(nowSec + 905);
  });

  it('calls sendMagicLink with the email and a URL containing the inserted token', async () => {
    createUser('user@example.com');

    await postRequest({ email: 'user@example.com' });

    const row = dbMod.db
      .prepare('SELECT token FROM magic_links WHERE email = ?')
      .get('user@example.com') as { token: string };
    expect(mockedSendMagicLink).toHaveBeenCalledWith(
      'user@example.com',
      expect.stringContaining(row.token),
    );
  });

  it('normalizes email: trims whitespace and lowercases before lookup', async () => {
    createUser('foo@example.com');

    const res = await postRequest({ email: '  Foo@Example.com  ' });
    expect(res.status).toBe(200);

    const row = dbMod.db
      .prepare('SELECT token FROM magic_links WHERE email = ?')
      .get('foo@example.com') as { token: string } | undefined;
    expect(row).toBeDefined();
  });

  it('rate-limits: second POST for same email does not insert a second magic_links row', async () => {
    createUser('rl@example.com');

    const first = await postRequest({ email: 'rl@example.com' });
    expect(first.status).toBe(200);

    const second = await postRequest({ email: 'rl@example.com' });
    expect(second.status).toBe(200);

    const count = (
      dbMod.db
        .prepare('SELECT COUNT(*) as n FROM magic_links WHERE email = ?')
        .get('rl@example.com') as { n: number }
    ).n;
    expect(count).toBe(1);
  });

  it('still returns 200 and keeps the magic_links row when sendMagicLink throws', async () => {
    mockedSendMagicLink.mockRejectedValueOnce(new Error('smtp down'));
    createUser('fail@example.com');

    const res = await postRequest({ email: 'fail@example.com' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const row = dbMod.db
      .prepare('SELECT token FROM magic_links WHERE email = ?')
      .get('fail@example.com') as { token: string } | undefined;
    expect(row).toBeDefined();
  });
});
