import { parseArgs } from 'node:util';
import { stmts } from '../src/server/db.js';
import { createFolder, findFolderByName } from '../src/server/drive.js';

const PARENT_FOLDER_NAME = 'paperstem';

if (!process.env.PAPERSTEM_LOCAL_DRIVE_ROOT?.trim()) {
  console.error(
    'PAPERSTEM_LOCAL_DRIVE_ROOT is not set. ' +
      'Set it to a directory path before running this script.',
  );
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    'band-id': { type: 'string' },
    force: { type: 'boolean', default: false },
  },
  strict: true,
});

const onlyBandId = values['band-id']?.trim();
const force = values.force === true;

const bands = onlyBandId
  ? (() => {
      const b = stmts.findBandById.get(onlyBandId);
      return b ? [b] : [];
    })()
  : stmts.findAllBands.all();

if (bands.length === 0) {
  console.error(onlyBandId ? `Band not found: ${onlyBandId}` : 'No bands in DB.');
  process.exit(1);
}

const parent =
  (await findFolderByName(PARENT_FOLDER_NAME, 'root')) ??
  (await createFolder(PARENT_FOLDER_NAME));
console.log(`parent folder: ${PARENT_FOLDER_NAME} (${parent.id})`);

for (const band of bands) {
  const isAlreadyLocal = band.drive_folder_id.startsWith('local:');
  if (isAlreadyLocal && !force) {
    console.log(`skip ${band.id} (${band.name}) — already local`);
    continue;
  }

  const existing = await findFolderByName(band.name, parent.id);
  const folder = existing ?? (await createFolder(band.name, parent.id));
  stmts.updateBandDriveFolder.run(folder.id, band.id);
  console.log(
    `band ${band.id} (${band.name}) -> ${folder.id}` +
      (existing ? ' (reused)' : ' (created)'),
  );
}

console.log('Done.');
