import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, extname, isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { stmts } from '../src/server/db.js';
import { createFolder, uploadFile } from '../src/server/drive.js';

const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
};

const { values } = parseArgs({
  options: {
    'band-id': { type: 'string' },
    name: { type: 'string' },
    'recorded-on': { type: 'string' },
    files: { type: 'string' },
  },
  strict: true,
});

const bandId = values['band-id']?.trim();
const practiceName = values.name?.trim();
const recordedOn = values['recorded-on']?.trim() || null;
const filesArg = values.files?.trim() ?? '';

if (!bandId || !practiceName || !filesArg) {
  console.error(
    'Usage: tsx bin/seed-practice.ts --band-id <uuid> --name <name> ' +
      '--files a.mp3,b.mp3 [--recorded-on YYYY-MM-DD]',
  );
  process.exit(1);
}

const filePaths = filesArg
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map((p) => (isAbsolute(p) ? p : resolve(process.cwd(), p)));

if (filePaths.length === 0) {
  console.error('No files specified');
  process.exit(1);
}

const band = stmts.findBandById.get(bandId);
if (!band) {
  console.error(`Band not found: ${bandId}`);
  process.exit(1);
}
if (band.drive_folder_id.startsWith('PENDING_')) {
  console.error(
    `Band ${band.id} has placeholder drive_folder_id (${band.drive_folder_id}); ` +
      `run backfill-band-folder first`,
  );
  process.exit(1);
}

const owner = stmts.findUserById.get(band.owner_user_id);
if (!owner) {
  console.error(`Owner user not found: ${band.owner_user_id}`);
  process.exit(1);
}

const practiceFolder = await createFolder(practiceName, band.drive_folder_id);
console.log(`created practice folder ${practiceName} (${practiceFolder.id})`);

const practiceId = randomUUID();
const now = Math.floor(Date.now() / 1000);
stmts.insertPractice.run(
  practiceId,
  band.id,
  practiceName,
  recordedOn,
  practiceFolder.id,
  null,
  now,
  owner.id,
  now,
);
console.log(`inserted practice ${practiceId}`);

const stemSummaries: { id: string; name: string; size: number }[] = [];
for (let i = 0; i < filePaths.length; i++) {
  const filePath = filePaths[i];
  const filename = basename(filePath);
  const ext = extname(filename).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    console.error(`Unsupported file extension: ${ext} (${filePath})`);
    process.exit(1);
  }
  const stemName = basename(filename, ext);
  const contents = readFileSync(filePath);
  const uploaded = await uploadFile(practiceFolder.id, filename, mime, contents);
  const stemId = randomUUID();
  stmts.insertStem.run(
    stemId,
    practiceId,
    stemName,
    i,
    uploaded.id,
    null,
    uploaded.size,
  );
  console.log(
    `uploaded ${filename} (${uploaded.size} bytes) -> drive=${uploaded.id} stem=${stemId}`,
  );
  stemSummaries.push({ id: stemId, name: stemName, size: uploaded.size });
}

console.log(
  `Summary: practice=${practiceId} stems=${stemSummaries.length} ` +
    `total_bytes=${stemSummaries.reduce((s, x) => s + x.size, 0)}`,
);
