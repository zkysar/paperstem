import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-backups-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csec';
process.env.GOOGLE_REFRESH_TOKEN = 'rtok';

type DbModule = typeof import('../db.js');
type BackupsModule = typeof import('./backups.js');

let dbMod: DbModule;
let backupsMod: BackupsModule;

beforeAll(async () => {
  dbMod = await import('../db.js');
  backupsMod = await import('./backups.js');
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  dbMod.db.exec(
    'DELETE FROM annotations; DELETE FROM stems; DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
}

function createUser(email: string): string {
  const id = randomUUID();
  dbMod.stmts.insertUser.run(id, email, null, Math.floor(Date.now() / 1000));
  return id;
}

function createBand(name: string, ownerId: string): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertBand.run(id, name, 'drive-x', ownerId, now);
  dbMod.stmts.insertMembership.run(id, ownerId, 'owner', now);
  return id;
}

function addMember(bandId: string, userId: string) {
  dbMod.stmts.insertMembership.run(
    bandId,
    userId,
    'member',
    Math.floor(Date.now() / 1000),
  );
}

function insertProject(bandId: string, userId: string, name: string): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertProject.run(
    id,
    bandId,
    name,
    null,
    'project-folder',
    null,
    null,
    null,
    now,
    userId,
    now,
  );
  return id;
}

function insertStem(projectId: string, position: number, name: string): string {
  const id = randomUUID();
  dbMod.stmts.insertStem.run(id, projectId, name, position, 'drive-file', 1000, 100);
  return id;
}

function insertAnnotation(projectId: string, userId: string): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertAnnotation.run(id, projectId, userId, 0, null, 'note', 0, now, now);
  return id;
}

beforeEach(() => {
  reset();
});

describe('buildBandDump', () => {
  it('emits a sqlite buffer that opens cleanly with empty magic_links and sessions', () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const pid = insertProject(bandId, owner, 'project-1');
    insertStem(pid, 0, 'drums');
    insertAnnotation(pid, owner);

    const buf = backupsMod.buildBandDump(bandId);
    expect(Buffer.isBuffer(buf)).toBe(true);

    const dump = new Database(buf);
    try {
      const tables = dump
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all()
        .map((r) => r.name);
      expect(tables).toContain('magic_links');
      expect(tables).toContain('sessions');
      expect(tables).toContain('bands');
      expect(tables).toContain('projects');

      const mlCount = dump
        .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM magic_links')
        .get();
      expect(mlCount?.c).toBe(0);
      const sessCount = dump
        .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM sessions')
        .get();
      expect(sessCount?.c).toBe(0);

      const bandCount = dump
        .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM bands')
        .get();
      expect(bandCount?.c).toBe(1);
      const projectCount = dump
        .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM projects')
        .get();
      expect(projectCount?.c).toBe(1);
      const stemCount = dump
        .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM stems')
        .get();
      expect(stemCount?.c).toBe(1);
      const annCount = dump
        .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM annotations')
        .get();
      expect(annCount?.c).toBe(1);
    } finally {
      dump.close();
    }
  });

  it('only includes data for the selected band', () => {
    const ownerA = createUser('a@example.com');
    const ownerB = createUser('b@example.com');
    const bandA = createBand('A', ownerA);
    const bandB = createBand('B', ownerB);
    const pA = insertProject(bandA, ownerA, 'pa');
    const pB = insertProject(bandB, ownerB, 'pb');
    insertStem(pA, 0, 'a-stem');
    insertStem(pB, 0, 'b-stem');

    const buf = backupsMod.buildBandDump(bandA);
    const dump = new Database(buf);
    try {
      const projects = dump
        .prepare<[], { id: string; band_id: string }>('SELECT id, band_id FROM projects')
        .all();
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe(pA);
      expect(projects[0].band_id).toBe(bandA);

      const stems = dump
        .prepare<[], { project_id: string }>('SELECT project_id FROM stems')
        .all();
      expect(stems).toHaveLength(1);
      expect(stems[0].project_id).toBe(pA);
      expect(pB).not.toBe(pA);
    } finally {
      dump.close();
    }
  });

  it('only includes users who are members of the selected band', () => {
    const ownerA = createUser('a@example.com');
    const memberA = createUser('member-a@example.com');
    const ownerB = createUser('b@example.com');
    const bandA = createBand('A', ownerA);
    addMember(bandA, memberA);
    createBand('B', ownerB);

    const buf = backupsMod.buildBandDump(bandA);
    const dump = new Database(buf);
    try {
      const emails = dump
        .prepare<[], { email: string }>('SELECT email FROM users ORDER BY email')
        .all()
        .map((u) => u.email);
      expect(emails).toEqual(['a@example.com', 'member-a@example.com']);
    } finally {
      dump.close();
    }
  });
});

describe('selectFilesToDelete', () => {
  it('keeps the N newest dumps by chronological filename', () => {
    const files = [
      { id: '1', name: 'd1-2026-01-01.sqlite' },
      { id: '2', name: 'd1-2026-02-01.sqlite' },
      { id: '3', name: 'd1-2026-03-01.sqlite' },
      { id: '4', name: 'd1-2026-04-01.sqlite' },
      { id: '5', name: 'd1-2026-05-01.sqlite' },
    ];
    const toDelete = backupsMod.selectFilesToDelete(files, 3);
    const ids = toDelete.map((f) => f.id).sort();
    expect(ids).toEqual(['1', '2']);
  });

  it('returns empty when fewer than retain are present', () => {
    const files = [
      { id: '1', name: 'd1-2026-01-01.sqlite' },
      { id: '2', name: 'd1-2026-02-01.sqlite' },
    ];
    expect(backupsMod.selectFilesToDelete(files, 8)).toEqual([]);
  });

  it('ignores non-dump files', () => {
    const files = [
      { id: '1', name: 'd1-2026-01-01.sqlite' },
      { id: '2', name: 'd1-2026-02-01.sqlite' },
      { id: '3', name: 'README.md' },
      { id: '4', name: 'd1-2026-03-01.sqlite' },
    ];
    const toDelete = backupsMod.selectFilesToDelete(files, 2);
    expect(toDelete.map((f) => f.id)).toEqual(['1']);
  });
});
