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

describe('flushPendingNotifications batched', () => {
  it('sends one digest per recipient grouping events by project', async () => {
    const author = createUser('a@e.test');
    const recipient = createUser('r@e.test');
    const bandId = createBand(author);
    addMembership(bandId, recipient);
    setPref(recipient);
    const p1 = insertProject(bandId, author, 'Mix v3');
    const p2 = insertProject(bandId, author, 'Demo 1');
    const a1 = insertAnnotation(p1, author, 'one');
    const a2 = insertAnnotation(p1, author, 'two');
    const a3 = insertAnnotation(p2, author, 'three');
    for (const [sid, pid] of [[a1, p1], [a2, p1], [a3, p2]] as Array<[string, string]>) {
      dbMod.stmts.insertPendingNotification.run(
        randomUUID(), recipient, 'comment', pid, 'annotation', sid, author, 'x', 'tok', 1,
      );
    }
    await flushMod.flushPendingNotifications({ mode: 'batched', appBaseUrl: 'https://x', inboundDomain: 'mail.x' });
    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    const arg = sendMailSpy.mock.calls[0][0];
    expect(arg.subject).toBe('Activity in 2 projects');
    expect(arg.text).toContain('"Mix v3"');
    expect(arg.text).toContain('"Demo 1"');
  });

  it('skips daily-only users in batched run', async () => {
    const author = createUser('a@e.test');
    const recipient = createUser('r@e.test');
    const bandId = createBand(author);
    addMembership(bandId, recipient);
    const pid = insertProject(bandId, author);
    const annId = insertAnnotation(pid, author, 'hi');
    setPref(recipient, { email_project_activity: 'daily' });
    dbMod.stmts.insertPendingNotification.run(
      randomUUID(), recipient, 'comment', pid, 'annotation', annId, author, 'hi', 'tok', 1,
    );
    await flushMod.flushPendingNotifications({ mode: 'batched', appBaseUrl: 'https://x', inboundDomain: 'mail.x' });
    expect(sendMailSpy).not.toHaveBeenCalled();
  });

  it('does nothing when no unsent rows exist', async () => {
    await flushMod.flushPendingNotifications({ mode: 'batched', appBaseUrl: 'https://x', inboundDomain: 'mail.x' });
    expect(sendMailSpy).not.toHaveBeenCalled();
  });
});

describe('flushPendingNotifications daily', () => {
  it('only flushes users whose local hour matches digest_hour_local', async () => {
    const author = createUser('a@e.test');
    const r1 = createUser('r1@e.test');
    const r2 = createUser('r2@e.test');
    const bandId = createBand(author);
    addMembership(bandId, r1);
    addMembership(bandId, r2);
    const pid = insertProject(bandId, author);
    setPref(r1, { email_project_activity: 'daily', digest_hour_local: 8, timezone: 'America/Los_Angeles' });
    setPref(r2, { email_project_activity: 'daily', digest_hour_local: 8, timezone: 'Australia/Sydney' });
    const annId = insertAnnotation(pid, author, 'hi');
    for (const u of [r1, r2]) {
      dbMod.stmts.insertPendingNotification.run(
        randomUUID(), u, 'comment', pid, 'annotation', annId, author, 'hi', 'tok', 1,
      );
    }
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T15:00:00Z'));
    await flushMod.flushPendingNotifications({ mode: 'daily', appBaseUrl: 'https://x', inboundDomain: 'mail.x' });
    vi.useRealTimers();

    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    expect(sendMailSpy.mock.calls[0][0].to).toBe('r1@e.test');
  });
});

describe('flushPendingNotifications per-row routing', () => {
  it('mixed-pref user gets only matching-kind rows per run, not all-or-nothing per recipient', async () => {
    // User has email_project_activity='batched' (so comment rows route batched)
    // and email_thread_activity='daily' (so reply rows route daily).
    // Batched run should send the comment but leave the reply queued.
    const author = createUser('a@e.test');
    const recipient = createUser('mixed@e.test');
    const bandId = createBand(author);
    addMembership(bandId, recipient);
    const pid = insertProject(bandId, author);
    setPref(recipient, {
      email_project_activity: 'batched',
      email_thread_activity: 'daily',
      digest_hour_local: 8,
      timezone: 'UTC',
    });
    const annId = insertAnnotation(pid, author, 'parent');
    const commentRowId = randomUUID();
    const replyRowId = randomUUID();
    dbMod.stmts.insertPendingNotification.run(
      commentRowId, recipient, 'comment', pid, 'annotation', annId, author, 'c-preview', 'tokC', 1,
    );
    dbMod.stmts.insertPendingNotification.run(
      replyRowId, recipient, 'reply', pid, 'reply', annId, author, 'r-preview', 'tokR', 1,
    );

    await flushMod.flushPendingNotifications({ mode: 'batched', appBaseUrl: 'https://x', inboundDomain: 'mail.x' });

    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    const arg = sendMailSpy.mock.calls[0][0];
    expect(arg.text).toContain('c-preview');
    expect(arg.text).not.toContain('r-preview');

    const commentRow = dbMod.stmts.findPendingById.get(commentRowId) as { sent_at: number | null };
    const replyRow = dbMod.stmts.findPendingById.get(replyRowId) as { sent_at: number | null };
    expect(commentRow.sent_at).not.toBeNull();
    expect(replyRow.sent_at).toBeNull(); // reply still queued for daily flush
  });

  it('sends mention rows via sendMentionEmail (one per mention), not bundled into a digest', async () => {
    const author = createUser('a@e.test');
    const recipient = createUser('r@e.test');
    const bandId = createBand(author);
    addMembership(bandId, recipient);
    setPref(recipient);
    const pid = insertProject(bandId, author);
    const annId = insertAnnotation(pid, author, 'hi');
    const mentionRowId = randomUUID();
    const commentRowId = randomUUID();
    dbMod.stmts.insertPendingNotification.run(
      mentionRowId, recipient, 'mention', pid, 'annotation', annId, author, 'mention-preview', 'tokM', 1,
    );
    dbMod.stmts.insertPendingNotification.run(
      commentRowId, recipient, 'comment', pid, 'annotation', annId, author, 'comment-preview', 'tokC', 1,
    );

    await flushMod.flushPendingNotifications({ mode: 'batched', appBaseUrl: 'https://x', inboundDomain: 'mail.x' });

    // One mention email + one digest email.
    expect(sendMailSpy).toHaveBeenCalledTimes(2);
    const subjects = sendMailSpy.mock.calls.map((call) => call[0].subject);
    expect(subjects.some((s) => s.includes('mention-preview'))).toBe(true);
    expect(subjects.some((s) => /new comment/i.test(s) || /^a@e\.test/.test(s))).toBe(true);
  });
});
