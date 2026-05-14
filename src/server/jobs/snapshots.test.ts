import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- env prelude: must run before any dynamic import of db.ts / mailer.ts / storage.ts ----
const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-snapshots-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
const audioRoot = join(tmpDir, 'audio');
mkdirSync(audioRoot, { recursive: true });
process.env.DATABASE_PATH = dbPath;
process.env.PAPERSTEM_AUDIO_ROOT = audioRoot;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

type DbModule = typeof import('../db.js');
type SnapshotsModule = typeof import('./snapshots.js');

let dbMod: DbModule;
let snapMod: SnapshotsModule;

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  dbMod.db.exec(
    'DELETE FROM annotations; DELETE FROM stems; DELETE FROM projects; ' +
      'DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; ' +
      'DELETE FROM magic_links; DELETE FROM users;',
  );
  rmSync(audioRoot, { recursive: true, force: true });
  mkdirSync(audioRoot, { recursive: true });
}

beforeEach(async () => {
  // Fresh module instances per test so snapshots.ts's module-private
  // `runInFlight` cannot leak across tests. snapshots imports db, so both
  // must be re-imported together to keep dbMod and snapMod pointing at the
  // same db instance.
  vi.resetModules();
  dbMod = await import('../db.js');
  snapMod = await import('./snapshots.js');
  reset();
});

// ---- helper factories ----

function createUser(email: string): string {
  const id = randomUUID();
  dbMod.stmts.insertUser.run(id, email, null, Math.floor(Date.now() / 1000));
  return id;
}

function createBand(name: string, ownerId: string, folderId = 'band-folder'): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertBand.run(id, name, folderId, ownerId, now);
  dbMod.stmts.insertMembership.run(id, ownerId, 'owner', now);
  return id;
}

/** The folder_id must be a valid base64url-encoded path relative to audioRoot. */
function insertProject(
  bandId: string,
  userId: string,
  name: string,
  folderId = 'project-folder',
): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertProject.run(id, bandId, name, null, folderId, null, now, userId, now);
  return id;
}

function insertStem(projectId: string, position: number, name: string): string {
  const id = randomUUID();
  dbMod.stmts.insertStem.run(id, projectId, name, position, 'file-x', 1000, 100, null);
  return id;
}

function insertAnnotation(projectId: string, userId: string): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertAnnotation.run(id, projectId, userId, 500, null, 'a note', 0, now, now);
  return id;
}

// ---- buildProjectMeta ----

describe('buildProjectMeta', () => {
  it('returns the correct schema_version and band/project fields', () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('My Band', owner);
    const band = dbMod.stmts.findBandById.get(bandId)!;
    const pid = insertProject(bandId, owner, 'Song One');
    const project = dbMod.stmts.findProjectById.get(pid)!;

    const nowSec = 1_700_000_000;
    const meta = snapMod.buildProjectMeta(band, project, nowSec);

    expect(meta.schema_version).toBe(1);
    expect(meta.snapshot_at).toBe(nowSec);
    expect(meta.band).toEqual({ id: bandId, name: 'My Band' });
    expect(meta.project.id).toBe(pid);
    expect(meta.project.name).toBe('Song One');
  });

  it('includes stems and annotations with correct shapes', () => {
    const owner = createUser('a@example.com');
    const bandId = createBand('Band A', owner);
    const band = dbMod.stmts.findBandById.get(bandId)!;
    const pid = insertProject(bandId, owner, 'Track');
    const project = dbMod.stmts.findProjectById.get(pid)!;
    insertStem(pid, 0, 'drums');
    insertStem(pid, 1, 'bass');
    insertAnnotation(pid, owner);

    const meta = snapMod.buildProjectMeta(band, project, 0);

    expect(meta.stems).toHaveLength(2);
    expect(meta.stems[0].name).toBe('drums');
    expect(meta.stems[1].name).toBe('bass');
    expect(meta.annotations).toHaveLength(1);
    expect(meta.annotations[0].body).toBe('a note');
    expect(meta.annotations[0].user_email).toBe('a@example.com');
    expect(typeof meta.annotations[0].starred).toBe('boolean');
  });

  it('returns empty stems and annotations for a bare project', () => {
    const owner = createUser('b@example.com');
    const bandId = createBand('Band B', owner);
    const band = dbMod.stmts.findBandById.get(bandId)!;
    const pid = insertProject(bandId, owner, 'Empty');
    const project = dbMod.stmts.findProjectById.get(pid)!;

    const meta = snapMod.buildProjectMeta(band, project, 0);

    expect(meta.stems).toEqual([]);
    expect(meta.annotations).toEqual([]);
  });
});

// ---- runSnapshotsNow ----
//
// storage.ts reads PAPERSTEM_AUDIO_ROOT inside each call, so we can let the
// real filesystem functions run against our tmpDir. We use vi.spyOn to
// intercept calls to storage.js without preventing the real work.

describe('runSnapshotsNow', () => {
  it('writes _meta.json into each project folder and updates last_snapshot_at', async () => {
    // Build a folder structure under audioRoot that matches the project's folder_id.
    // storage.ts encodes rel-paths as base64url; a literal ASCII folder name is its
    // own base64url ID only for the ROOT level. For a subfolder we need to encode.
    // Use a root-level folder (empty parent rel) so the ID is simply the folder name.
    const owner = createUser('c@example.com');
    const bandId = createBand('Band C', owner);

    // Create a folder under audioRoot and derive its storage ID.
    const folderName = 'proj-c-folder';
    mkdirSync(join(audioRoot, folderName), { recursive: true });
    // encodeId(rel) = Buffer.from(rel,'utf8').toString('base64url')
    const folderId = Buffer.from(folderName, 'utf8').toString('base64url');
    const pid = insertProject(bandId, owner, 'Song C', folderId);
    insertStem(pid, 0, 'guitar');

    await snapMod.runSnapshotsNow();

    // _meta.json should now exist in the project folder
    const metaPath = join(audioRoot, folderName, '_meta.json');
    expect(existsSync(metaPath)).toBe(true);

    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
      schema_version: number;
      band: { name: string };
      project: { name: string };
      stems: { name: string }[];
    };
    expect(meta.schema_version).toBe(1);
    expect(meta.band.name).toBe('Band C');
    expect(meta.project.name).toBe('Song C');
    expect(meta.stems).toHaveLength(1);
    expect(meta.stems[0].name).toBe('guitar');

    // DB side-effect: last_snapshot_at updated
    const band = dbMod.stmts.findBandById.get(bandId)!;
    expect(typeof band.last_snapshot_at).toBe('number');
    expect(band.last_snapshot_at).toBeGreaterThan(0);
  });

  it('updates an existing _meta.json rather than creating a second file', async () => {
    const owner = createUser('d@example.com');
    const bandId = createBand('Band D', owner);

    const folderName = 'proj-d-folder';
    mkdirSync(join(audioRoot, folderName), { recursive: true });
    const folderId = Buffer.from(folderName, 'utf8').toString('base64url');
    insertProject(bandId, owner, 'Song D', folderId);

    // Run twice — first creates, second updates.
    await snapMod.runSnapshotsNow();
    await snapMod.runSnapshotsNow();

    const entries = readdirSync(join(audioRoot, folderName));
    const metaFiles = entries.filter((e) => e === '_meta.json');
    expect(metaFiles).toHaveLength(1);
  });

  it('runInFlight deduplication: concurrent calls run the write only once', async () => {
    const storageMod = await import('../storage.js');
    const uploadSpy = vi.spyOn(storageMod, 'uploadFile');
    const updateSpy = vi.spyOn(storageMod, 'updateFile');

    const owner = createUser('e@example.com');
    const bandId = createBand('Band E', owner);

    const folderName = 'proj-e-folder';
    mkdirSync(join(audioRoot, folderName), { recursive: true });
    const folderId = Buffer.from(folderName, 'utf8').toString('base64url');
    insertProject(bandId, owner, 'Song E', folderId);

    // Fire two concurrent calls — the second should attach to the in-flight promise.
    const [r1, r2] = await Promise.all([
      snapMod.runSnapshotsNow(),
      snapMod.runSnapshotsNow(),
    ]);
    expect(r1).toBeUndefined();
    expect(r2).toBeUndefined();

    // upload or update should have been called exactly once for the single project.
    const totalStorageWrites = uploadSpy.mock.calls.length + updateSpy.mock.calls.length;
    expect(totalStorageWrites).toBe(1);

    uploadSpy.mockRestore();
    updateSpy.mockRestore();
  });

  it('a per-band failure does not prevent other bands from being snapshotted', async () => {
    const storageMod = await import('../storage.js');

    const owner = createUser('f@example.com');
    // Band F — storage.uploadFile will be spied to throw for THIS project,
    // simulating any IO failure (permission denied, disk full, etc.).
    const bandFId = createBand('Band F', owner);
    const folderF = 'proj-f-folder';
    mkdirSync(join(audioRoot, folderF), { recursive: true });
    const folderFId = Buffer.from(folderF, 'utf8').toString('base64url');
    const projectFId = insertProject(bandFId, owner, 'Song F', folderFId);

    // Band G — healthy; project folder exists.
    const ownerG = createUser('g@example.com');
    const bandGId = createBand('Band G', ownerG);
    const folderG = 'proj-g-folder';
    mkdirSync(join(audioRoot, folderG), { recursive: true });
    const folderGId = Buffer.from(folderG, 'utf8').toString('base64url');
    insertProject(bandGId, ownerG, 'Song G', folderGId);

    // Force a real failure ONLY for band F's project folder.
    const realUpload = storageMod.uploadFile;
    const uploadSpy = vi
      .spyOn(storageMod, 'uploadFile')
      .mockImplementation(async (parentId, name, mime, body) => {
        if (parentId === folderFId) {
          throw new Error('simulated storage failure');
        }
        return realUpload(parentId, name, mime, body);
      });

    // Capture console.error so we can verify the per-band failure was logged
    // (the production contract for "this band failed").
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Should not throw even though Band F's project will error.
    await expect(snapMod.runSnapshotsNow()).resolves.toBeUndefined();

    // Band G's meta file was written despite Band F's failure.
    expect(existsSync(join(audioRoot, folderG, '_meta.json'))).toBe(true);

    // Band F's meta file was NOT written (uploadFile threw before writing).
    expect(existsSync(join(audioRoot, folderF, '_meta.json'))).toBe(false);

    // The failure was logged for Band F's project, identifying which one broke.
    expect(errorSpy).toHaveBeenCalled();
    const loggedForBandF = errorSpy.mock.calls.some((call) => {
      const msg = call[0];
      return typeof msg === 'string' && msg.includes(bandFId) && msg.includes(projectFId);
    });
    expect(loggedForBandF, 'console.error must identify the failing band/project').toBe(
      true,
    );

    uploadSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
