import { randomUUID } from 'node:crypto';
import { stmts } from '../db.js';
import { createFolder, findFolderByName } from '../drive.js';
import { isDevLoginEnabled } from './dev-login.js';

const DEFAULT_BAND_NAME = 'Dev Band';

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
  const folder =
    (await findFolderByName(bandName, 'root')) ??
    (await createFolder(bandName));

  const bandId = randomUUID();
  stmts.insertBand.run(bandId, bandName, folder.id, user.id, nowSec);
  stmts.insertMembership.run(bandId, user.id, 'owner', nowSec);

  console.log(
    `[dev-seed] created band '${bandName}' (${bandId}) for ${email}, drive=${folder.id}`,
  );
}
