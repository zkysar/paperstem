import { parseArgs } from 'node:util';
import { stmts } from '../src/server/db.js';
import {
  createFolder,
  findFolderByName,
  shareFolder,
} from '../src/server/drive.js';

const PARENT_FOLDER_NAME = 'paperstem';

const { values } = parseArgs({
  options: {
    'band-id': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  strict: true,
});

const bandId = values['band-id']?.trim();
const dryRun = values['dry-run'] === true;

if (!bandId) {
  console.error(
    'Usage: tsx bin/backfill-band-folder.ts --band-id <uuid> [--dry-run]',
  );
  process.exit(1);
}

const band = stmts.findBandById.get(bandId);
if (!band) {
  console.error(`Band not found: ${bandId}`);
  process.exit(1);
}

if (!band.folder_id.startsWith('PENDING_')) {
  console.error(
    `Band ${band.id} already has folder ${band.folder_id}; aborting. ` +
      `(No --force flag in v1; edit the DB by hand if you really mean it.)`,
  );
  process.exit(1);
}

const members = stmts.findMembershipsForBand.all(band.id);
const memberEmails = members.map((m) => m.email);

if (dryRun) {
  console.log(
    `[dry-run] would create folder named ${PARENT_FOLDER_NAME}/${band.name}`,
  );
  console.log(`[dry-run] would share with: ${memberEmails.join(', ')}`);
  process.exit(0);
}

const parent = await findFolderByName(PARENT_FOLDER_NAME, 'root');
let parentId: string;
if (parent) {
  parentId = parent.id;
  console.log(`reusing existing parent folder ${PARENT_FOLDER_NAME} (${parentId})`);
} else {
  const created = await createFolder(PARENT_FOLDER_NAME);
  parentId = created.id;
  console.log(`created parent folder ${PARENT_FOLDER_NAME} (${parentId})`);
}

const bandFolder = await createFolder(band.name, parentId);
console.log(`created band folder ${band.name} (${bandFolder.id})`);

for (const email of memberEmails) {
  await shareFolder(bandFolder.id, email, 'reader');
  console.log(`shared with ${email}`);
}

stmts.updateBandDriveFolder.run(bandFolder.id, band.id);
console.log(`updated bands.folder_id for ${band.id} -> ${bandFolder.id}`);
console.log(
  `Summary: band=${band.id} folder=${bandFolder.id} shared_with=${memberEmails.length}`,
);
