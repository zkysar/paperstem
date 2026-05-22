import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stmts } from '../db.js';
import { createFolder, findFolderByName, uploadFile } from '../storage.js';
import { isDevLoginEnabled } from './dev-login.js';

const DEFAULT_BAND_NAME = 'Dev Band';
const SEED_PROJECT_NAME = 'Sample project';
const SEED_STEMS: { name: string; file: string }[] = [
  { name: 'drums', file: 'drums.mp3' },
  { name: 'bass', file: 'bass.mp3' },
  { name: 'guitar', file: 'guitar.mp3' },
];

function seedAssetsDir(): string {
  return fileURLToPath(new URL('../../../assets/dev-seed/', import.meta.url));
}

type SeedPeaks = Record<string, { peaks: string; durationMs: number }>;

// Precomputed peaks + duration for the sample stems (generated from the MP3s
// in this folder). Attaching these mirrors a real upload — which sends both —
// so the dev seed loads with an instant waveform and a stable timeline rather
// than everything snapping in once the background decode finishes.
function loadSeedPeaks(assetsDir: string): SeedPeaks {
  try {
    const raw = readFileSync(assetsDir + 'peaks.json', 'utf8');
    return JSON.parse(raw) as SeedPeaks;
  } catch {
    return {};
  }
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

  const seedPeaks = loadSeedPeaks(assetsDir);

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
    const precomputed = seedPeaks[stem.name] ?? null;
    stmts.insertStem.run(
      randomUUID(),
      projectId,
      stem.name,
      i,
      uploaded.id,
      precomputed?.durationMs ?? null,
      uploaded.size,
      precomputed?.peaks ?? null,
    );
  }

  console.log(
    `[dev-seed] seeded project '${SEED_PROJECT_NAME}' (${projectId}) with ${presentStems.length} stems`,
  );
}
