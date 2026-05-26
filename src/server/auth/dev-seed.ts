import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stmts } from '../db.js';
import { findOrCreateSongRow } from '../songs.js';
import { createFolder, findFolderByName, uploadFile } from '../storage.js';
import { isDevLoginEnabled } from './dev-login.js';

const DEFAULT_BAND_NAME = 'Dev Band';
const SEED_PROJECT_NAME = 'Sample project';
const SEED_STEMS: { name: string; file: string }[] = [
  { name: 'drums', file: 'drums.mp3' },
  { name: 'bass', file: 'bass.mp3' },
  { name: 'guitar', file: 'guitar.mp3' },
];

// A small song catalog so the picker's "Filter by song" facet has chips to
// show. Enough names that the chip row overflows a phone-width picker, which
// is what exercises the single-row horizontal-scroll behaviour in e2e.
const SEED_SETLIST_NAME = 'Setlist (demo)';
const SEED_SONGS = [
  'Midnight Drive',
  'Open Road',
  'Paper Moon',
  'Slow Burn',
  'Tidewater',
  'Hollow Hymn',
];

function seedAssetsDir(): string {
  return fileURLToPath(new URL('../../../assets/dev-seed/', import.meta.url));
}

export async function seedDevBandIfNeeded(): Promise<void> {
  if (!isDevLoginEnabled()) return;

  const email = process.env.PAPERSTEM_DEV_AUTO_LOGIN!.trim().toLowerCase();
  const nowSec = Math.floor(Date.now() / 1000);

  let user = stmts.findUserByEmail.get(email);
  if (!user) {
    const id = randomUUID();
    stmts.insertUser.run(id, email, null, nowSec);
    user = stmts.findUserByEmail.get(email);
    if (!user) return;
  }

  const existingBands = stmts.findBandsForUser.all(user.id);
  if (existingBands.length > 0) return;

  const bandName = process.env.PAPERSTEM_DEV_SEED_BAND_NAME?.trim() || DEFAULT_BAND_NAME;
  const bandFolder =
    (await findFolderByName(bandName, 'root')) ??
    (await createFolder(bandName));

  const bandId = randomUUID();
  stmts.insertBand.run(bandId, bandName, bandFolder.id, user.id, nowSec);
  stmts.insertMembership.run(bandId, user.id, 'owner', nowSec);

  console.log(
    `[dev-seed] created band '${bandName}' (${bandId}) for ${email}, folder=${bandFolder.id}`,
  );

  await seedSampleProject(bandId, bandFolder.id, user.id, nowSec);
  await seedSongCatalog(bandId, bandFolder.id, user.id, nowSec);
}

// Create a handful of catalog songs and a dedicated demo project whose
// sections reference them, so each song gets a non-zero use_count and shows up
// as a "Filter by song" chip. Kept separate from the Sample project so the
// primary fixture other journeys load stays free of sections.
async function seedSongCatalog(
  bandId: string,
  bandFolderId: string,
  userId: string,
  nowSec: number,
): Promise<void> {
  const songIds = SEED_SONGS.map(
    (name) => findOrCreateSongRow(bandId, name, userId)?.id,
  ).filter((id): id is string => Boolean(id));
  if (songIds.length === 0) return;

  const setlistFolder =
    (await findFolderByName(SEED_SETLIST_NAME, bandFolderId)) ??
    (await createFolder(SEED_SETLIST_NAME, bandFolderId));

  const projectId = randomUUID();
  stmts.insertProject.run(
    projectId,
    bandId,
    SEED_SETLIST_NAME,
    null,
    setlistFolder.id,
    null,
    nowSec,
    userId,
    nowSec,
  );

  songIds.forEach((songId, i) => {
    stmts.insertSection.run(
      randomUUID(),
      projectId,
      i * 30_000,
      songId,
      null,
      'manual',
      nowSec,
      userId,
      nowSec,
    );
  });

  console.log(
    `[dev-seed] seeded ${songIds.length} songs + '${SEED_SETLIST_NAME}' project (${projectId})`,
  );
}

async function seedSampleProject(
  bandId: string,
  bandFolderId: string,
  userId: string,
  nowSec: number,
): Promise<void> {
  const assetsDir = seedAssetsDir();
  const presentStems = SEED_STEMS.filter((s) => existsSync(assetsDir + s.file));
  if (presentStems.length === 0) {
    console.log('[dev-seed] no sample MP3s found in assets/dev-seed/, skipping project');
    return;
  }

  const projectFolder =
    (await findFolderByName(SEED_PROJECT_NAME, bandFolderId)) ??
    (await createFolder(SEED_PROJECT_NAME, bandFolderId));

  const projectId = randomUUID();
  stmts.insertProject.run(
    projectId,
    bandId,
    SEED_PROJECT_NAME,
    null,
    projectFolder.id,
    null,
    nowSec,
    userId,
    nowSec,
  );

  for (let i = 0; i < presentStems.length; i++) {
    const stem = presentStems[i];
    const body = readFileSync(assetsDir + stem.file);
    const uploaded = await uploadFile(
      projectFolder.id,
      stem.file,
      'audio/mpeg',
      body,
    );
    stmts.insertStem.run(
      randomUUID(),
      projectId,
      stem.name,
      i,
      uploaded.id,
      null,
      uploaded.size,
      null,
    );
  }

  console.log(
    `[dev-seed] seeded project '${SEED_PROJECT_NAME}' (${projectId}) with ${presentStems.length} stems`,
  );
}
