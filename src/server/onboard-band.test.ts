import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

const repoRoot = resolve(__dirname, '../..');
const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-onboard-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
const audioRoot = join(tmpDir, 'audio');

type RunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function runOnboard(args: string[]): RunResult {
  const result = spawnSync(
    'npx',
    ['tsx', 'bin/onboard-band.ts', ...args],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_PATH: dbPath,
        PAPERSTEM_AUDIO_ROOT: audioRoot,
        GMAIL_USER: 'test@example.com',
        GMAIL_APP_PASSWORD: 'test-pass',
        PAPERSTEM_SKIP_MAIL: '1',
        APP_URL: 'http://localhost:5173',
      },
      encoding: 'utf8',
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

let raw: Database.Database;

beforeAll(() => {
  raw = new Database(dbPath);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  const schema = readFileSync(
    resolve(repoRoot, 'src/server/schema.sql'),
    'utf8',
  );
  raw.exec(schema);
});

afterAll(() => {
  raw.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  raw.exec(
    'DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
  rmSync(audioRoot, { recursive: true, force: true });
});

function decodeId(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf8');
}

describe('onboard-band CLI', () => {
  it('creates a band, owner, members, memberships, and on-disk folder', () => {
    const res = runOnboard([
      '--name',
      'Test Band',
      '--owner-email',
      'owner@example.com',
      '--member-emails',
      'a@example.com,b@example.com',
    ]);

    expect(res.status, res.stderr).toBe(0);

    const bands = raw
      .prepare<[], { id: string; name: string; folder_id: string; owner_user_id: string }>(
        'SELECT id, name, folder_id, owner_user_id FROM bands',
      )
      .all();
    expect(bands).toHaveLength(1);
    expect(bands[0].name).toBe('Test Band');
    expect(bands[0].folder_id).not.toMatch(/^PENDING_/);
    expect(existsSync(join(audioRoot, decodeId(bands[0].folder_id)))).toBe(
      true,
    );

    const users = raw
      .prepare<[], { email: string }>('SELECT email FROM users ORDER BY email')
      .all();
    expect(users.map((u) => u.email)).toEqual([
      'a@example.com',
      'b@example.com',
      'owner@example.com',
    ]);

    const memberships = raw
      .prepare<[string], { role: string; email: string }>(
        `SELECT m.role, u.email
           FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.band_id = ?
          ORDER BY u.email`,
      )
      .all(bands[0].id);
    expect(memberships).toEqual([
      { role: 'member', email: 'a@example.com' },
      { role: 'member', email: 'b@example.com' },
      { role: 'owner', email: 'owner@example.com' },
    ]);
  });

  it('lowercases and trims emails', () => {
    const res = runOnboard([
      '--name',
      'Case Band',
      '--owner-email',
      '  Owner@Example.COM ',
      '--member-emails',
      ' MEMBER@Example.com , owner@example.com ',
    ]);
    expect(res.status, res.stderr).toBe(0);
    const emails = raw
      .prepare<[], { email: string }>('SELECT email FROM users ORDER BY email')
      .all()
      .map((u) => u.email);
    expect(emails).toEqual(['member@example.com', 'owner@example.com']);
  });

  it('aborts when re-run with the same name + owner', () => {
    const first = runOnboard([
      '--name',
      'Dup Band',
      '--owner-email',
      'owner@example.com',
    ]);
    expect(first.status, first.stderr).toBe(0);

    const second = runOnboard([
      '--name',
      'Dup Band',
      '--owner-email',
      'owner@example.com',
    ]);
    expect(second.status).not.toBe(0);
    expect(second.stderr).toMatch(/already exists/);

    const count = raw
      .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM bands')
      .get();
    expect(count?.c).toBe(1);
  });

  it('rejects invalid emails', () => {
    const res = runOnboard([
      '--name',
      'Bad Band',
      '--owner-email',
      'not-an-email',
    ]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/Invalid owner email/);
  });

  it('requires --name and --owner-email', () => {
    const res = runOnboard(['--name', 'Just Name']);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/Usage:/);
  });
});
