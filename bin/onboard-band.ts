import { randomBytes, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { db, stmts } from '../src/server/db.js';
import { tryAddToAllowlist } from '../src/server/allowlist.js';
import { sendBandInvite } from '../src/server/mailer.js';
import { createFolder } from '../src/server/storage.js';

const MAGIC_LINK_TTL_SECONDS = 15 * 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    'owner-email': { type: 'string' },
    'member-emails': { type: 'string' },
  },
  strict: true,
});

const name = values.name?.trim();
const ownerEmailRaw = values['owner-email']?.trim().toLowerCase();
const memberEmailsRaw = values['member-emails']?.trim() ?? '';

if (!name || !ownerEmailRaw) {
  console.error(
    'Usage: tsx bin/onboard-band.ts --name <name> --owner-email <email> [--member-emails <a@x,b@y>]',
  );
  process.exit(1);
}

if (!EMAIL_RE.test(ownerEmailRaw)) {
  console.error(`Invalid owner email: ${ownerEmailRaw}`);
  process.exit(1);
}

const memberEmails = memberEmailsRaw
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter((e) => e.length > 0)
  .filter((e) => e !== ownerEmailRaw);

for (const e of memberEmails) {
  if (!EMAIL_RE.test(e)) {
    console.error(`Invalid member email: ${e}`);
    process.exit(1);
  }
}

const dedupedMemberEmails = Array.from(new Set(memberEmails));

const skipMail = process.env.PAPERSTEM_SKIP_MAIL === '1';

function upsertUser(email: string): string {
  const existing = stmts.findUserByEmail.get(email);
  if (existing) return existing.id;
  const id = randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);
  stmts.insertUser.run(id, email, null, createdAt);
  return id;
}

let folder: { id: string };
try {
  folder = await createFolder(name!);
} catch (err) {
  console.error(
    `[onboard-band] createFolder failed:`,
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
}

const seedBand = db.transaction(() => {
  const ownerId = upsertUser(ownerEmailRaw!);
  // The CLI is the on-the-server admin path; anyone it touches is
  // implicitly approved, so keep the allowlist in sync.
  tryAddToAllowlist(ownerEmailRaw!, null, 'onboard-band CLI');
  for (const email of dedupedMemberEmails) {
    tryAddToAllowlist(email, ownerId, 'onboard-band CLI');
  }

  const duplicate = stmts.findBandByNameAndOwner.get(name!, ownerId);
  if (duplicate) {
    throw new Error(
      `Band '${name}' already exists for owner ${ownerEmailRaw} (id=${duplicate.id}); ` +
        `if you want to add members to it, use a different command — or just edit the DB`,
    );
  }

  const memberIds: { email: string; userId: string }[] = [];
  for (const email of dedupedMemberEmails) {
    memberIds.push({ email, userId: upsertUser(email) });
  }

  const bandId = randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);
  stmts.insertBand.run(bandId, name!, folder.id, ownerId, createdAt);

  stmts.insertMembership.run(bandId, ownerId, 'owner', createdAt);
  for (const m of memberIds) {
    stmts.insertMembership.run(bandId, m.userId, 'member', createdAt);
  }

  return { bandId, ownerId, memberIds, createdAt };
});

let result: ReturnType<typeof seedBand>;
try {
  result = seedBand();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

console.log(`Created band ${result.bandId} '${name}'`);
console.log(`Owner: ${result.ownerId} <${ownerEmailRaw}>`);
for (const m of result.memberIds) {
  console.log(`Member: ${m.userId} <${m.email}>`);
}

let invitesSent = 0;
if (skipMail) {
  console.log('PAPERSTEM_SKIP_MAIL=1 set; skipping invite emails');
} else {
  const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
  for (const m of result.memberIds) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Math.floor(Date.now() / 1000) + MAGIC_LINK_TTL_SECONDS;
    stmts.insertMagicLink.run(token, m.email, expiresAt);
    const link = `${appUrl}/auth/callback?token=${token}`;
    try {
      await sendBandInvite(m.email, name!, link);
      console.log(`Sent invite to ${m.email}`);
      invitesSent += 1;
    } catch (err) {
      console.error(
        `[onboard-band] sendBandInvite failed for ${m.email}:`,
        err,
      );
    }
  }
}

console.log(
  `Summary: band=${result.bandId} owner=${ownerEmailRaw} members=${result.memberIds.length} invites_sent=${invitesSent}`,
);
