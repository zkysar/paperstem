import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stmts } from '../db.js';
import { findOrCreateSongRow } from '../songs.js';
import { createFolder, findFolderByName, uploadFile } from '../storage.js';
import { isDevLoginEnabled } from './dev-login.js';

const DEFAULT_BAND_NAME = 'Dev Band';
const SEED_PROJECT_NAME = 'Sample project';
// Opt-in second project with one long (multi-segment) stem. Off by default so
// the normal dev experience stays the 3-stem "Sample project"; the e2e suite
// sets PAPERSTEM_DEV_SEED_LONG_STEM to a 60s MP3 so the seek-into-unbuffered
// journey has a stem long enough to seek past the head segment. See
// tests/e2e/journeys/seek-buffering.spec.ts.
const LONG_PROJECT_NAME = 'Long sample project';
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
  await seedSongCatalog(bandId, bandFolder.id, user.id, nowSec);
  await seedLongStemProjectIfRequested(bandId, bandFolder.id, user.id, nowSec);
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

/**
 * When PAPERSTEM_DEV_SEED_LONG_STEM points at an MP3, seed a second project
 * containing exactly that one (long) stem. Used by the e2e suite to get a stem
 * with multiple ~20s segments — the dev-seed MP3s are ~5s (single segment), too
 * short to seek into an undecoded region. Single-stem on purpose: it keeps the
 * route interception in the journey unambiguous (one stem = one audio id).
 */
async function seedLongStemProjectIfRequested(
  bandId: string,
  bandFolderId: string,
  userId: string,
  nowSec: number,
): Promise<void> {
  const longStemPath = process.env.PAPERSTEM_DEV_SEED_LONG_STEM?.trim();
  if (!longStemPath) return;
  if (!existsSync(longStemPath)) {
    console.log(
      `[dev-seed] PAPERSTEM_DEV_SEED_LONG_STEM=${longStemPath} not found, skipping long project`,
    );
    return;
  }

  const projectFolder =
    (await findFolderByName(LONG_PROJECT_NAME, bandFolderId)) ??
    (await createFolder(LONG_PROJECT_NAME, bandFolderId));

  const projectId = randomUUID();
  stmts.insertProject.run(
    projectId,
    bandId,
    LONG_PROJECT_NAME,
    null,
    projectFolder.id,
    null,
    nowSec,
    userId,
    nowSec,
  );

  const body = readFileSync(longStemPath);
  const uploaded = await uploadFile(
    projectFolder.id,
    'long-tone.mp3',
    'audio/mpeg',
    body,
  );
  // duration_ms MUST be set: the client only segments a stem when it knows the
  // duration up front (usePlayer.ts: `metaDuration != null && > 0` gates
  // planSegments). Without it the stem takes the full-file decode path — one
  // buffer, no per-segment Range fetches — and the seek-into-unbuffered stall
  // can't happen. The fixture is a 60s clip.
  const LONG_STEM_DURATION_MS = 60_000;
  stmts.insertStem.run(
    randomUUID(),
    projectId,
    'long tone',
    0,
    uploaded.id,
    LONG_STEM_DURATION_MS,
    uploaded.size,
    null,
  );

  console.log(
    `[dev-seed] seeded project '${LONG_PROJECT_NAME}' (${projectId}) with 1 long stem from ${longStemPath}`,
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
