import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-notifications-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('./db.js');
type NotificationsModule = typeof import('./notifications.js');
let dbMod: DbModule;
let notifMod: NotificationsModule;

beforeAll(async () => {
  dbMod = await import('./db.js');
  notifMod = await import('./notifications.js');
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  dbMod.db.exec(
    'DELETE FROM pending_notifications; DELETE FROM band_mutes; DELETE FROM notification_prefs; DELETE FROM project_reads; DELETE FROM mentions; DELETE FROM annotation_reply_reactions; DELETE FROM annotation_reactions; DELETE FROM annotation_replies; DELETE FROM annotations; DELETE FROM stems; DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; DELETE FROM users;',
  );
}

beforeEach(() => reset());

// Test helpers — keep in sync with annotations.test.ts patterns.
function createUser(email: string, displayName: string | null = null): string {
  const id = randomUUID();
  dbMod.db.prepare(
    'INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, email, displayName, 1);
  return id;
}

function createBand(ownerId: string, name = 'b'): string {
  const id = randomUUID();
  dbMod.db.prepare(
    'INSERT INTO bands (id, name, folder_id, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, name, 'folder', ownerId, 1);
  dbMod.db.prepare(
    'INSERT INTO memberships (band_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, ownerId, 'owner', 1);
  return id;
}

function addMembership(bandId: string, userId: string, role: 'owner' | 'member' = 'member') {
  dbMod.db.prepare(
    'INSERT INTO memberships (band_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
  ).run(bandId, userId, role, 1);
}

function insertProject(bandId: string, userId: string, name = 'p'): string {
  const id = randomUUID();
  dbMod.db.prepare(
    'INSERT INTO projects (id, band_id, name, folder_id, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, bandId, name, 'folder', 1, userId, 1);
  return id;
}

function insertAnnotation(projectId: string, userId: string, body: string): string {
  const id = randomUUID();
  dbMod.db.prepare(
    'INSERT INTO annotations (id, project_id, user_id, start_ms, end_ms, body, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, projectId, userId, 0, null, body, 0, 1, 1);
  return id;
}

function insertReply(annotationId: string, userId: string, body: string): string {
  const id = randomUUID();
  dbMod.db.prepare(
    'INSERT INTO annotation_replies (id, annotation_id, user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, annotationId, userId, body, 1, 1);
  return id;
}

describe('parseMentions', () => {
  it('extracts uid tokens', () => {
    const out = notifMod.parseMentions('hello @[abc123] and @[def456], also stray @ sign');
    expect(out.sort()).toEqual(['abc123', 'def456'].sort());
  });
  it('returns empty array for no tokens', () => {
    expect(notifMod.parseMentions('plain text')).toEqual([]);
  });
  it('ignores malformed tokens', () => {
    expect(notifMod.parseMentions('@[BAD!] and @[ok123]')).toEqual(['ok123']);
  });
  it('deduplicates repeated mentions of the same uid', () => {
    expect(notifMod.parseMentions('@[abc] @[abc]')).toEqual(['abc']);
  });
});

describe('resolveMentions', () => {
  it('drops uids that are not band members for the project', () => {
    const me = createUser('me@e.test');
    const them = createUser('t@e.test');
    const ghost = createUser('g@e.test');
    const bandId = createBand(me);
    addMembership(bandId, them);
    const pid = insertProject(bandId, me);

    const resolved = notifMod.resolveMentions([them, ghost], pid);
    expect(resolved).toEqual([them]);
  });
  it('returns empty when no uids provided', () => {
    expect(notifMod.resolveMentions([], 'unused')).toEqual([]);
  });
});

describe('recipientsForComment', () => {
  it('returns all band members except author', () => {
    const author = createUser('a@e.test');
    const m1 = createUser('m1@e.test');
    const m2 = createUser('m2@e.test');
    const bandId = createBand(author);
    addMembership(bandId, m1);
    addMembership(bandId, m2);
    const pid = insertProject(bandId, author);

    const got = notifMod.recipientsForComment(pid, author);
    expect(got.sort()).toEqual([m1, m2].sort());
  });
});

describe('recipientsForReply', () => {
  it('returns annotation author plus prior repliers minus current author', () => {
    const author = createUser('a@e.test');
    const r1 = createUser('r1@e.test');
    const r2 = createUser('r2@e.test');
    const bandId = createBand(author);
    addMembership(bandId, r1);
    addMembership(bandId, r2);
    const pid = insertProject(bandId, author);
    const annId = insertAnnotation(pid, author, 'parent');
    insertReply(annId, r1, 'first');

    const got = notifMod.recipientsForReply(annId, r2);
    expect(got.sort()).toEqual([author, r1].sort());
  });
  it('returns empty when annotation not found', () => {
    expect(notifMod.recipientsForReply('missing', 'who')).toEqual([]);
  });
});

describe('recipientsForReaction', () => {
  it('returns target author when reactor differs', () => {
    const author = createUser('a@e.test');
    const reactor = createUser('r@e.test');
    const bandId = createBand(author);
    addMembership(bandId, reactor);
    const pid = insertProject(bandId, author);
    const annId = insertAnnotation(pid, author, 'hi');

    expect(notifMod.recipientsForReaction('annotation', annId, reactor)).toEqual([author]);
  });
  it('returns empty when reactor is target author', () => {
    const author = createUser('a@e.test');
    const bandId = createBand(author);
    const pid = insertProject(bandId, author);
    const annId = insertAnnotation(pid, author, 'hi');
    expect(notifMod.recipientsForReaction('annotation', annId, author)).toEqual([]);
  });
  it('handles reply source type', () => {
    const author = createUser('a@e.test');
    const replier = createUser('r@e.test');
    const reactor = createUser('rx@e.test');
    const bandId = createBand(author);
    addMembership(bandId, replier);
    addMembership(bandId, reactor);
    const pid = insertProject(bandId, author);
    const annId = insertAnnotation(pid, author, 'parent');
    const replyId = insertReply(annId, replier, 'r1');
    expect(notifMod.recipientsForReaction('reply', replyId, reactor)).toEqual([replier]);
  });
});

function setPref(userId: string, p: Partial<{
  email_mentions: number;
  email_project_activity: 'batched' | 'daily' | 'off';
  email_thread_activity: 'batched' | 'daily' | 'off';
  digest_hour_local: number;
  timezone: string;
}>) {
  dbMod.stmts.upsertNotificationPrefs.run(
    userId,
    p.email_mentions ?? 1,
    p.email_project_activity ?? 'batched',
    p.email_thread_activity ?? 'batched',
    p.digest_hour_local ?? 8,
    p.timezone ?? 'UTC',
    Date.now(),
  );
}

function muteBand(userId: string, bandId: string) {
  dbMod.stmts.insertBandMute.run(userId, bandId, Date.now());
}

describe('applyPrefsFilter', () => {
  it('drops recipients whose pref is off for the kind', () => {
    const author = createUser('a@e.test');
    const m1 = createUser('m1@e.test');
    const m2 = createUser('m2@e.test');
    const bandId = createBand(author);
    addMembership(bandId, m1);
    addMembership(bandId, m2);
    setPref(m1, { email_project_activity: 'off' });
    expect(notifMod.applyPrefsFilter([m1, m2], bandId, 'comment').sort()).toEqual([m2].sort());
  });
  it('drops muted-band recipients regardless of pref', () => {
    const author = createUser('a@e.test');
    const m1 = createUser('m1@e.test');
    const bandId = createBand(author);
    addMembership(bandId, m1);
    muteBand(m1, bandId);
    expect(notifMod.applyPrefsFilter([m1], bandId, 'mention')).toEqual([]);
  });
  it('keeps users with no prefs row (defaults apply)', () => {
    const author = createUser('a@e.test');
    const m1 = createUser('m1@e.test');
    const bandId = createBand(author);
    addMembership(bandId, m1);
    expect(notifMod.applyPrefsFilter([m1], bandId, 'comment')).toEqual([m1]);
  });
  it('uses email_thread_activity for kind=reply', () => {
    const author = createUser('a@e.test');
    const m1 = createUser('m1@e.test');
    const bandId = createBand(author);
    addMembership(bandId, m1);
    setPref(m1, { email_thread_activity: 'off', email_project_activity: 'batched' });
    expect(notifMod.applyPrefsFilter([m1], bandId, 'reply')).toEqual([]);
    expect(notifMod.applyPrefsFilter([m1], bandId, 'comment')).toEqual([m1]);
  });
});

describe('getEffectivePrefs', () => {
  it('returns defaults when no row exists', () => {
    const u = createUser('u@e.test');
    const prefs = notifMod.getEffectivePrefs(u);
    expect(prefs).toMatchObject({
      email_mentions: 1, email_project_activity: 'batched', email_thread_activity: 'batched',
      digest_hour_local: 8, timezone: 'UTC',
    });
  });
});

describe('recordActivity', () => {
  it('creates a pending_notifications row per recipient for a top-level comment', () => {
    const author = createUser('a@e.test');
    const m1 = createUser('m1@e.test');
    const m2 = createUser('m2@e.test');
    const bandId = createBand(author);
    addMembership(bandId, m1);
    addMembership(bandId, m2);
    const pid = insertProject(bandId, author);
    const annId = insertAnnotation(pid, author, 'hi everyone');

    notifMod.recordActivity({
      kind: 'comment', sourceType: 'annotation', sourceId: annId,
      projectId: pid, authorId: author, body: 'hi everyone',
    });

    const rows = dbMod.db.prepare('SELECT recipient_id, kind FROM pending_notifications').all() as Array<{ recipient_id: string; kind: string }>;
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.kind === 'comment')).toBe(true);
    expect(new Set(rows.map((r) => r.recipient_id))).toEqual(new Set([m1, m2]));
  });

  it('emits mention rows and dedups to mention-priority for a recipient who is both', () => {
    const author = createUser('a@e.test');
    const m1 = createUser('m1@e.test');
    const bandId = createBand(author);
    addMembership(bandId, m1);
    const pid = insertProject(bandId, author);
    const body = `hey @[${m1}] thoughts?`;
    const annId = insertAnnotation(pid, author, body);

    notifMod.recordActivity({
      kind: 'comment', sourceType: 'annotation', sourceId: annId,
      projectId: pid, authorId: author, body,
    });

    const mentions = dbMod.db.prepare('SELECT target_user_id FROM mentions').all() as Array<{ target_user_id: string }>;
    expect(mentions.length).toBe(1);
    expect(mentions[0].target_user_id).toBe(m1);

    const pending = dbMod.db.prepare('SELECT kind, recipient_id FROM pending_notifications').all() as Array<{ kind: string; recipient_id: string }>;
    expect(pending.length).toBe(1);
    expect(pending[0]).toMatchObject({ kind: 'mention', recipient_id: m1 });
  });

  it('does not enqueue when only the author is in the band', () => {
    const author = createUser('a@e.test');
    const bandId = createBand(author);
    const pid = insertProject(bandId, author);
    const annId = insertAnnotation(pid, author, 'solo');
    notifMod.recordActivity({
      kind: 'comment', sourceType: 'annotation', sourceId: annId,
      projectId: pid, authorId: author, body: 'solo',
    });
    const count = dbMod.db.prepare('SELECT COUNT(*) AS c FROM pending_notifications').get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('rolls back when the wrapping transaction fails', () => {
    const author = createUser('a@e.test');
    const m1 = createUser('m1@e.test');
    const bandId = createBand(author);
    addMembership(bandId, m1);
    const pid = insertProject(bandId, author);
    const annId = insertAnnotation(pid, author, 'x');

    expect(() =>
      dbMod.db.transaction(() => {
        notifMod.recordActivity({
          kind: 'comment', sourceType: 'annotation', sourceId: annId,
          projectId: pid, authorId: author, body: 'x',
        });
        throw new Error('bail');
      })(),
    ).toThrow('bail');

    const count = dbMod.db.prepare('SELECT COUNT(*) AS c FROM pending_notifications').get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('resolves mention preview using display names (or email if no display_name)', () => {
    const author = createUser('a@e.test');
    const m1 = createUser('m1@e.test', 'Sarah Lee');
    const bandId = createBand(author);
    addMembership(bandId, m1);
    const pid = insertProject(bandId, author);
    const body = `hi @[${m1}] check this`;
    const annId = insertAnnotation(pid, author, body);

    notifMod.recordActivity({
      kind: 'comment', sourceType: 'annotation', sourceId: annId,
      projectId: pid, authorId: author, body,
    });

    const row = dbMod.db.prepare('SELECT preview FROM pending_notifications').get() as { preview: string };
    expect(row.preview).toContain('@Sarah Lee');
  });

  it('records a reply correctly: notifies annotation author + prior repliers, not current author', () => {
    const a = createUser('a@e.test');
    const b = createUser('b@e.test');
    const c = createUser('c@e.test');
    const bandId = createBand(a);
    addMembership(bandId, b);
    addMembership(bandId, c);
    const pid = insertProject(bandId, a);
    const annId = insertAnnotation(pid, a, 'parent');
    insertReply(annId, c, 'prior');
    const replyId = insertReply(annId, b, 'new');

    notifMod.recordActivity({
      kind: 'reply', sourceType: 'reply', sourceId: replyId,
      projectId: pid, authorId: b, body: 'new',
    });

    const rows = dbMod.db.prepare('SELECT recipient_id FROM pending_notifications').all() as Array<{ recipient_id: string }>;
    expect(new Set(rows.map((r) => r.recipient_id))).toEqual(new Set([a, c]));
  });

  it('records a reaction correctly: notifies target author only', () => {
    const author = createUser('a@e.test');
    const reactor = createUser('r@e.test');
    const bandId = createBand(author);
    addMembership(bandId, reactor);
    const pid = insertProject(bandId, author);
    const annId = insertAnnotation(pid, author, 'parent');

    notifMod.recordActivity({
      kind: 'reaction', sourceType: 'annotation', sourceId: annId,
      projectId: pid, authorId: reactor, body: '',
    });
    const rows = dbMod.db.prepare('SELECT recipient_id, kind FROM pending_notifications').all();
    expect(rows).toEqual([{ recipient_id: author, kind: 'reaction' }]);
  });
});
