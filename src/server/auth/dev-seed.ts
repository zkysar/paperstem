import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stmts } from '../db.js';
import { createFolder, findFolderByName, uploadFile } from '../drive.js';
import { isDevLoginEnabled } from './dev-login.js';

const DEFAULT_BAND_NAME = 'Dev Band';
const SEED_PRACTICE_NAME = 'Sample practice';
const SEED_STEMS: { name: string; file: string }[] = [
  { name: 'drums', file: 'drums.mp3' },
  { name: 'bass', file: 'bass.mp3' },
  { name: 'guitar', file: 'guitar.mp3' },
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
    `[dev-seed] created band '${bandName}' (${bandId}) for ${email}, drive=${bandFolder.id}`,
  );

  await seedSamplePractice(bandId, bandFolder.id, user.id, nowSec);
}

async function seedSamplePractice(
  bandId: string,
  bandFolderId: string,
  userId: string,
  nowSec: number,
): Promise<void> {
  const assetsDir = seedAssetsDir();
  const presentStems = SEED_STEMS.filter((s) => existsSync(assetsDir + s.file));
  if (presentStems.length === 0) {
    console.log('[dev-seed] no sample MP3s found in assets/dev-seed/, skipping practice');
    return;
  }

  const practiceFolder =
    (await findFolderByName(SEED_PRACTICE_NAME, bandFolderId)) ??
    (await createFolder(SEED_PRACTICE_NAME, bandFolderId));

  const practiceId = randomUUID();
  stmts.insertPractice.run(
    practiceId,
    bandId,
    SEED_PRACTICE_NAME,
    null,
    practiceFolder.id,
    null,
    nowSec,
    userId,
    nowSec,
  );

  for (let i = 0; i < presentStems.length; i++) {
    const stem = presentStems[i];
    const body = readFileSync(assetsDir + stem.file);
    const uploaded = await uploadFile(
      practiceFolder.id,
      stem.file,
      'audio/mpeg',
      body,
    );
    stmts.insertStem.run(
      randomUUID(),
      practiceId,
      stem.name,
      i,
      uploaded.id,
      null,
      uploaded.size,
      null,
    );
  }

  console.log(
    `[dev-seed] seeded practice '${SEED_PRACTICE_NAME}' (${practiceId}) with ${presentStems.length} stems`,
  );
}
