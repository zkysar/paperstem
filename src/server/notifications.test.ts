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
