import { stmts, type UserRow } from './db.js';

// Single hardcoded gatekeeper. Anyone with this email — and only this
// email — can read/write the service invite allowlist. Band invites for
// any email not on the allowlist are rejected.
//
// Override via PAPERSTEM_GATEKEEPER_EMAIL in tests so we don't depend on
// the real address. The default is the production gatekeeper.
export function getGatekeeperEmail(): string {
  return (
    process.env.PAPERSTEM_GATEKEEPER_EMAIL?.trim().toLowerCase() ||
    'zach.kysar@gmail.com'
  );
}

export function isGatekeeper(user: Pick<UserRow, 'email'>): boolean {
  return user.email.toLowerCase() === getGatekeeperEmail();
}

export function isAllowlisted(email: string): boolean {
  return !!stmts.findAllowlistEntry.get(email.trim().toLowerCase());
}

// Gatekeeper-initiated add (admin route). Refreshes attribution if the
// email is already on the list — used by the gatekeeper to update notes.
export function addToAllowlist(
  email: string,
  addedByUserId: string | null,
  note: string | null = null,
): void {
  const nowSec = Math.floor(Date.now() / 1000);
  stmts.insertAllowlistEntry.run(
    email.trim().toLowerCase(),
    addedByUserId,
    nowSec,
    note,
  );
}

// Non-clobbering add for server-side helpers (CLI, dev-seed). Leaves any
// existing row's attribution intact.
export function tryAddToAllowlist(
  email: string,
  addedByUserId: string | null,
  note: string | null = null,
): void {
  const nowSec = Math.floor(Date.now() / 1000);
  stmts.tryInsertAllowlistEntry.run(
    email.trim().toLowerCase(),
    addedByUserId,
    nowSec,
    note,
  );
}
