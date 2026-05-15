import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-flush-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('./db.js');
type FlushModule = typeof import('./notifications-flush.js');
type MailerModule = typeof import('./mailer.js');

let dbMod: DbModule;
let flushMod: FlushModule;
let mailerMod: MailerModule;
let sendMailSpy: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  dbMod = await import('./db.js');
  flushMod = await import('./notifications-flush.js');
  mailerMod = await import('./mailer.js');
});

beforeEach(() => {
  sendMailSpy = vi.fn().mockResolvedValue({});
  (mailerMod._transporter as unknown as { sendMail: typeof sendMailSpy }).sendMail = sendMailSpy;
  dbMod.db.exec(
    'DELETE FROM pending_notifications; DELETE FROM band_mutes; DELETE FROM notification_prefs; DELETE FROM project_reads; DELETE FROM mentions; DELETE FROM annotation_reply_reactions; DELETE FROM annotation_reactions; DELETE FROM annotation_replies; DELETE FROM annotations; DELETE FROM stems; DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; DELETE FROM users;',
  );
});

afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

function createUser(email: string, displayName: string | null = null): string {
  const id = randomUUID();
  dbMod.db.prepare('INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)').run(id, email, displayName, 1);
  return id;
}

function createBand(ownerId: string, name = 'b'): string {
  const id = randomUUID();
  dbMod.db.prepare('INSERT INTO bands (id, name, folder_id, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, 'folder', ownerId, 1);
  dbMod.db.prepare('INSERT INTO memberships (band_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(id, ownerId, 'owner', 1);
  return id;
}

function addMembership(bandId: string, userId: string) {
  dbMod.db.prepare('INSERT INTO memberships (band_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(bandId, userId, 'member', 1);
}

function insertProject(bandId: string, userId: string, name = 'p'): string {
  const id = randomUUID();
  dbMod.db.prepare('INSERT INTO projects (id, band_id, name, folder_id, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, bandId, name, 'folder', 1, userId, 1);
  return id;
}

function insertAnnotation(projectId: string, userId: string, body: string): string {
  const id = randomUUID();
  dbMod.db.prepare('INSERT INTO annotations (id, project_id, user_id, start_ms, end_ms, body, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, projectId, userId, 0, null, body, 0, 1, 1);
  return id;
}

function setPref(userId: string, p: { email_mentions?: number; email_project_activity?: string; email_thread_activity?: string; digest_hour_local?: number; timezone?: string } = {}) {
  dbMod.stmts.upsertNotificationPrefs.run(
    userId,
    p.email_mentions ?? 1,
    (p.email_project_activity as string) ?? 'batched',
    (p.email_thread_activity as string) ?? 'batched',
    p.digest_hour_local ?? 8,
    p.timezone ?? 'UTC',
    1,
  );
}

describe('flushOne', () => {
  it('sends a mention email and stamps sent_at', async () => {
    const author = createUser('a@e.test');
    const recipient = createUser('r@e.test');
    const bandId = createBand(author);
    addMembership(bandId, recipient);
    const pid = insertProject(bandId, author);
    const annId = insertAnnotation(pid, author, 'hi');
    const id = randomUUID();
    dbMod.stmts.insertPendingNotification.run(
      id, recipient, 'mention', pid, 'annotation', annId, author, 'hi', 'tok1', 1,
    );

    await flushMod.flushOne(id, { appBaseUrl: 'https://x', inboundDomain: 'mail.x' });
    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    const arg = sendMailSpy.mock.calls[0][0];
    expect(arg.replyTo).toBe('replies+tok1@mail.x');

    const row = dbMod.stmts.findPendingById.get(id) as { sent_at: number | null };
    expect(row.sent_at).not.toBeNull();
  });

  it('records failure as send_attempts bump without sent_at', async () => {
    const author = createUser('a@e.test');
    const recipient = createUser('r@e.test');
    const bandId = createBand(author);
    addMembership(bandId, recipient);
    const pid = insertProject(bandId, author);
    const annId = insertAnnotation(pid, author, 'hi');
    const id = randomUUID();
    dbMod.stmts.insertPendingNotification.run(
      id, recipient, 'mention', pid, 'annotation', annId, author, 'hi', 'tok2', 1,
    );

    sendMailSpy.mockRejectedValueOnce(new Error('smtp down'));
    await flushMod.flushOne(id, { appBaseUrl: 'https://x', inboundDomain: 'mail.x' });
    const row = dbMod.stmts.findPendingById.get(id) as { sent_at: number | null; send_attempts: number };
    expect(row.sent_at).toBeNull();
    expect(row.send_attempts).toBe(1);
  });

  it('gives up after MAX_ATTEMPTS failures', async () => {
    const author = createUser('a@e.test');
    const recipient = createUser('r@e.test');
    const bandId = createBand(author);
    addMembership(bandId, recipient);
    const pid = insertProject(bandId, author);
    const annId = insertAnnotation(pid, author, 'hi');
    const id = randomUUID();
    dbMod.stmts.insertPendingNotification.run(
      id, recipient, 'comment', pid, 'annotation', annId, author, 'hi', 'tok3', 1,
    );
    dbMod.db.prepare('UPDATE pending_notifications SET send_attempts = 2 WHERE id = ?').run(id);
    sendMailSpy.mockRejectedValueOnce(new Error('still down'));
    await flushMod.flushOne(id, { appBaseUrl: 'https://x', inboundDomain: 'mail.x' });
    const row = dbMod.stmts.findPendingById.get(id) as { sent_at: number | null; send_attempts: number };
    expect(row.send_attempts).toBe(3);
    expect(row.sent_at).not.toBeNull();
  });
});
