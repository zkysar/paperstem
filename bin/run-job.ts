import { runSnapshotsNow } from '../src/server/jobs/snapshots.js';
import { runBackupsNow } from '../src/server/jobs/backups.js';

const job = process.argv[2];

if (!job) {
  console.error('Usage: tsx bin/run-job.ts <snapshots|backups>');
  process.exit(1);
}

if (job === 'snapshots') {
  await runSnapshotsNow();
} else if (job === 'backups') {
  await runBackupsNow();
} else {
  console.error(`Unknown job: ${job}. Expected 'snapshots' or 'backups'.`);
  process.exit(1);
}
