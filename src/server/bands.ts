import { randomBytes, randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { db, stmts } from './db.js';
import { recordAudit } from './audit.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';
import { sendBandInvite } from './mailer.js';
import { createFolder, trashItem } from './storage.js';

// Owners delete groups via handleDeleteBand (soft-delete + 30-day purge).
// Members leave via handleLeaveBand. Owners can leave too, but must hand
// the keys to another member in the same request — handleLeaveBand
// accepts an optional { transferTo } body for that. If the owner has no
// other members to transfer to, delete-the-group is the only exit.

const BAND_PURGE_AFTER_SECONDS = 30 * 24 * 60 * 60;
// Cap per-request purge work so a user returning to the app after a long
// absence doesn't eat O(N) filesystem renames + cascades on a single
// list-bands call. Subsequent requests drain the backlog. Bounded fs
// op-count keeps tail latency predictable.
const BAND_PURGE_BATCH_LIMIT = 10;
// In-process mutex: prevents two concurrent handleListBands invocations
// from both selecting the same to-be-purged row and racing on trashItem.
// Module-scoped — multiple replicas would still race, but the only
// guarantee we need is "no double-trashItem on the same folder within a
// process," which this provides. The lock is released in finally so a
// thrown trashItem error can't deadlock subsequent requests.
let purgeInProgress = false;

const MAX_GROUP_NAME_LEN = 80;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAGIC_LINK_TTL_SECONDS = 15 * 60;
// Mirrors the segment rules in storage.ts's sanitizeSegment, so a name
// the user typed in the UI never reaches createFolder() only to throw an
// opaque 500. Checked at the API boundary so we can return a clear
// `name_invalid` instead.
// eslint-disable-next-line no-control-regex
const NAME_INVALID_RE = /[\\/\x00-\x1f\x7f]/;
function nameInvalid(name: string): boolean {
  return name === '.' || name === '..' || NAME_INVALID_RE.test(name);
}

// Opportunistic sweep: any soft-deleted band past the 30-day retention
// window is hard-deleted (CASCADE wipes its projects/stems/comments) and
// its audio folder is moved to _trash on disk. Runs on the most-hit
// owner-visible endpoint so an owner's eventual return to the app
// guarantees their own trash gets cleaned up — there's no cron job yet.
// Errors per-band are logged and skipped so one bad row can't block the
// rest of the sweep.
//
// triggeredBy is the user whose request happened to trip the sweep, captured
// in the audit metadata so we can still answer "who triggered this purge?"
// even though the action itself is system-initiated (the band may have been
// deleted by an entirely different person).
async function purgeOldBands(triggeredBy: {
  id: string;
  email?: string | null;
}): Promise<void> {
  if (purgeInProgress) return;
  purgeInProgress = true;
  try {
    const cutoff = Math.floor(Date.now() / 1000) - BAND_PURGE_AFTER_SECONDS;
    const due = stmts.findBandsToPurge.all(cutoff, BAND_PURGE_BATCH_LIMIT);
    for (const band of due) {
      // Order matters: DELETE the DB row FIRST (CASCADE wipes
      // projects/stems/comments), then trash the audio. If trashItem
      // fails we end up with orphaned audio in the original location
      // rather than a phantom band row pointing at already-trashed
      // audio — orphaned files are easy to garbage-collect later;
      // phantom rows are not.
      try {
        stmts.purgeBand.run(band.id);
      } catch (err) {
        console.error('[bands] purge: DELETE failed', { id: band.id, err });
        continue;
      }
      try {
        await trashItem(band.folder_id);
      } catch (err) {
        console.warn('[bands] purge: trashItem failed (audio orphaned)', {
          id: band.id,
          folder_id: band.folder_id,
          err,
        });
      }
      recordAudit({
        action: 'band.purge',
        resource_type: 'band',
        resource_id: band.id,
        actor: null,
        band_id: band.id,
        metadata: {
          name: band.name,
          folder_id: band.folder_id,
          owner_user_id: band.owner_user_id,
          deleted_at: band.deleted_at,
          deleted_by: band.deleted_by,
          deleted_reason: band.deleted_reason,
          cutoff,
          triggered_by_user_id: triggeredBy.id,
          triggered_by_user_email: triggeredBy.email ?? null,
        },
      });
    }
  } finally {
    purgeInProgress = false;
  }
}

export async function handleListBands(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  await purgeOldBands({ id: user.id, email: user.email });
  const rows = stmts.findBandsForUser.all(user.id);
  const bands = rows.map((b) => ({
    id: b.id,
    name: b.name,
    folder_id: b.folder_id,
    owner_user_id: b.owner_user_id,
    created_at: b.created_at,
    role: b.role,
  }));
  return c.json({ bands });
}

export function handleGetBand(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const bandId = c.req.param('id') ?? '';
  if (!bandId) return c.json({ error: 'not_found' }, 404);

  const band = stmts.findBandById.get(bandId);
  if (!band) return c.json({ error: 'not_found' }, 404);

  const membership = stmts.findMembership.get(bandId, user.id);
  if (!membership) return c.json({ error: 'not_found' }, 404);

  const members = stmts.findMembershipsForBand.all(bandId);

  return c.json({
    band: {
      id: band.id,
      name: band.name,
      folder_id: band.folder_id,
      owner_user_id: band.owner_user_id,
      created_at: band.created_at,
    },
    members,
  });
}

export async function handleCreateBand(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  let body: { name?: unknown };
  try {
    body = (await c.req.json()) as { name?: unknown };
  } catch {
    return c.json({ error: 'bad_json' }, 400);
  }
  const name =
    typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return c.json({ error: 'name_required' }, 400);
  if (name.length > MAX_GROUP_NAME_LEN) {
    return c.json({ error: 'name_too_long' }, 400);
  }
  if (nameInvalid(name)) return c.json({ error: 'name_invalid' }, 400);

  let folder: { id: string };
  try {
    folder = await createFolder(name);
  } catch (err) {
    console.error('[create-band] createFolder failed:', err);
    return c.json({ error: 'storage_failed' }, 500);
  }

  // Wrap the dup-check + inserts in a synchronous transaction so two
  // concurrent POSTs from the same owner can't both pass the SELECT
  // while the other request is still awaiting createFolder() above.
  // better-sqlite3 transactions are synchronous, so the critical section
  // can't yield. The folder created above may be orphaned on conflict;
  // createFolder is idempotent (mkdir recursive) so a retry reuses it.
  //
  // The duplicate check spans ANY-state bands, including soft-deleted ones
  // pending purge: their audio folder under PAPERSTEM_AUDIO_ROOT/<name>
  // still exists, so a new band with the same name would share folder_id
  // and the purge sweep would eventually trash the live band's audio. The
  // name is reserved until purge completes.
  const bandId = randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);
  const result = db.transaction(() => {
    const duplicate = stmts.findBandByNameAndOwnerAnyState.get(name, user.id);
    if (duplicate) {
      return {
        conflict: true,
        deleted: duplicate.deleted_at !== null,
      } as const;
    }
    stmts.insertBand.run(bandId, name, folder.id, user.id, createdAt);
    stmts.insertMembership.run(bandId, user.id, 'owner', createdAt);
    return { conflict: false, deleted: false } as const;
  })();
  if (result.conflict) {
    return c.json(
      {
        error: result.deleted
          ? 'duplicate_name_pending_purge'
          : 'duplicate_name',
      },
      409,
    );
  }

  return c.json(
    {
      band: {
        id: bandId,
        name,
        folder_id: folder.id,
        owner_user_id: user.id,
        created_at: createdAt,
        role: 'owner',
      },
    },
    201,
  );
}

export async function handleInviteMember(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  const bandId = c.req.param('id') ?? '';
  if (!bandId) return c.json({ error: 'not_found' }, 404);

  // Owner-only — same existence-leak shape as handleGetBand: non-members
  // get 404 instead of 403 so they can't probe band ids.
  const membership = stmts.findMembership.get(bandId, user.id);
  if (!membership) return c.json({ error: 'not_found' }, 404);
  if (membership.role !== 'owner') return c.json({ error: 'forbidden' }, 403);

  let body: { email?: unknown };
  try {
    body = (await c.req.json()) as { email?: unknown };
  } catch {
    return c.json({ error: 'bad_json' }, 400);
  }
  const emailRaw =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!emailRaw) return c.json({ error: 'email_required' }, 400);
  if (!EMAIL_RE.test(emailRaw)) return c.json({ error: 'bad_email' }, 400);

  const band = stmts.findBandById.get(bandId);
  if (!band) return c.json({ error: 'not_found' }, 404);

  // Upsert the invited user. Matches bin/onboard-band.ts's upsertUser
  // behavior so the CLI and the in-app invite stay symmetric.
  // `users.email` is UNIQUE, so two concurrent invites with the same new
  // email would race past `findUserByEmail` and one `insertUser` would
  // throw SQLITE_CONSTRAINT. We catch and re-find so the loser of the
  // race gets a 201 with the row the winner just inserted.
  const nowSec = Math.floor(Date.now() / 1000);
  let invitedUser = stmts.findUserByEmail.get(emailRaw);
  if (!invitedUser) {
    const newId = randomUUID();
    try {
      stmts.insertUser.run(newId, emailRaw, null, nowSec);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'SQLITE_CONSTRAINT_UNIQUE' && code !== 'SQLITE_CONSTRAINT') {
        throw err;
      }
    }
    invitedUser = stmts.findUserByEmail.get(emailRaw);
    if (!invitedUser) return c.json({ error: 'storage_failed' }, 500);
  }

  const existing = stmts.findMembership.get(bandId, invitedUser.id);
  if (existing) return c.json({ error: 'already_member' }, 409);

  stmts.insertMembership.run(bandId, invitedUser.id, 'member', nowSec);

  // Send the magic link unless the env opts out. Failures don't roll back
  // the membership — the inviter can resend; the owner can ask the
  // invitee to sign in via the regular magic-link flow.
  let invitedAndMailed = false;
  if (process.env.PAPERSTEM_SKIP_MAIL !== '1') {
    try {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = nowSec + MAGIC_LINK_TTL_SECONDS;
      stmts.insertMagicLink.run(token, emailRaw, expiresAt);
      const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
      const link = `${appUrl}/auth/callback?token=${token}`;
      await sendBandInvite(emailRaw, band.name, link);
      invitedAndMailed = true;
    } catch (err) {
      console.error('[invite-member] sendBandInvite failed:', err);
    }
  }

  return c.json(
    {
      member: {
        id: invitedUser.id,
        email: invitedUser.email,
        display_name: invitedUser.display_name,
        role: 'member',
      },
      mailed: invitedAndMailed,
    },
    201,
  );
}

export async function handleRenameBand(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  const bandId = c.req.param('id') ?? '';
  if (!bandId) return c.json({ error: 'not_found' }, 404);

  const membership = stmts.findMembership.get(bandId, user.id);
  if (!membership) return c.json({ error: 'not_found' }, 404);
  if (membership.role !== 'owner') return c.json({ error: 'forbidden' }, 403);

  let body: { name?: unknown };
  try {
    body = (await c.req.json()) as { name?: unknown };
  } catch {
    return c.json({ error: 'bad_json' }, 400);
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return c.json({ error: 'name_required' }, 400);
  if (name.length > MAX_GROUP_NAME_LEN) {
    return c.json({ error: 'name_too_long' }, 400);
  }
  if (nameInvalid(name)) return c.json({ error: 'name_invalid' }, 400);

  // Same per-owner uniqueness rule as create: a user can't end up with two
  // bands of the same name. Allow no-op renames (same name → success).
  // The dup check spans soft-deleted bands too (see handleCreateBand for
  // the folder-collision rationale).
  const band = stmts.findBandById.get(bandId);
  if (!band) return c.json({ error: 'not_found' }, 404);
  if (name !== band.name) {
    const duplicate = stmts.findBandByNameAndOwnerAnyState.get(name, user.id);
    if (duplicate && duplicate.id !== bandId) {
      return c.json(
        {
          error: duplicate.deleted_at !== null
            ? 'duplicate_name_pending_purge'
            : 'duplicate_name',
        },
        409,
      );
    }
    stmts.renameBand.run(name, bandId);
  }

  return c.json({
    band: {
      id: bandId,
      name,
      folder_id: band.folder_id,
      owner_user_id: band.owner_user_id,
      created_at: band.created_at,
    },
  });
}

export function handleRemoveMember(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const bandId = c.req.param('id') ?? '';
  const targetUserId = c.req.param('userId') ?? '';
  if (!bandId || !targetUserId) return c.json({ error: 'not_found' }, 404);

  const caller = stmts.findMembership.get(bandId, user.id);
  if (!caller) return c.json({ error: 'not_found' }, 404);
  if (caller.role !== 'owner') return c.json({ error: 'forbidden' }, 403);

  // Owner trying to remove themself: that's not "remove member", it's
  // "delete group" (not implemented). Rejected explicitly so the action
  // is never silently a self-leave.
  if (targetUserId === user.id) {
    return c.json({ error: 'owner_cannot_be_removed' }, 409);
  }

  const target = stmts.findMembership.get(bandId, targetUserId);
  if (!target) return c.json({ error: 'not_found' }, 404);
  // Defense in depth: even though the band has exactly one owner today,
  // refuse to remove anyone with the owner role. Future-proofs against a
  // promotion flow.
  if (target.role === 'owner') {
    return c.json({ error: 'owner_cannot_be_removed' }, 409);
  }

  stmts.deleteMembership.run(bandId, targetUserId);
  return c.json({ ok: true });
}

export async function handleLeaveBand(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  const bandId = c.req.param('id') ?? '';
  if (!bandId) return c.json({ error: 'not_found' }, 404);

  const membership = stmts.findMembership.get(bandId, user.id);
  // Hide the band's existence from non-members: same 404 shape as a missing
  // band, no leaking of "this band exists but you aren't in it".
  if (!membership) return c.json({ error: 'not_found' }, 404);

  // Non-owner: same as before, just delete the membership. No body needed.
  if (membership.role !== 'owner') {
    stmts.deleteMembership.run(bandId, user.id);
    return c.json({ ok: true });
  }

  // Owner: must transfer ownership to another member in the same request.
  // DELETE with body is legal HTTP; some clients/middlewares strip it, so
  // missing/unparseable body is treated as "no transferTo provided" and
  // surfaces a clear error rather than an opaque 400.
  let transferTo = '';
  try {
    const body = (await c.req.json()) as { transferTo?: unknown };
    if (typeof body.transferTo === 'string') transferTo = body.transferTo;
  } catch {
    // empty body — fall through to the owner_must_transfer check below
  }

  if (!transferTo) {
    return c.json({ error: 'owner_must_transfer' }, 409);
  }
  if (transferTo === user.id) {
    return c.json({ error: 'cannot_transfer_to_self' }, 409);
  }

  // Pre-flight validation outside the transaction so we can return the right
  // error code; the same conditions are re-asserted *inside* the transaction
  // to close the TOCTOU window. A concurrent handleRemoveMember or
  // handleDeleteBand between these checks and the transaction body would
  // otherwise leave the band ownerless (UPDATE with 0 changes; nothing
  // throws).
  const target = stmts.findMembership.get(bandId, transferTo);
  if (!target) return c.json({ error: 'transfer_target_not_a_member' }, 409);

  const band = stmts.findBandById.get(bandId);
  if (!band) return c.json({ error: 'not_found' }, 404);

  class TransferConflict extends Error {
    constructor(public reason: string) {
      super(reason);
    }
  }

  try {
    db.transaction(() => {
      const promoted = stmts.setMembershipRole.run('owner', bandId, transferTo);
      if (promoted.changes !== 1) {
        throw new TransferConflict('transfer_target_not_a_member');
      }
      const repointed = stmts.setBandOwner.run(transferTo, bandId);
      if (repointed.changes !== 1) {
        // The band was soft-deleted between the pre-flight findBandById and
        // the transaction body. Roll back the role promotion.
        throw new TransferConflict('not_found');
      }
      const left = stmts.deleteMembership.run(bandId, user.id);
      if (left.changes !== 1) {
        // Caller's membership vanished mid-transaction. Roll back.
        throw new TransferConflict('not_found');
      }
    })();
  } catch (err) {
    if (err instanceof TransferConflict) {
      const status = err.reason === 'not_found' ? 404 : 409;
      return c.json({ error: err.reason }, status);
    }
    throw err;
  }

  recordAudit({
    action: 'band.transfer_ownership',
    resource_type: 'band',
    resource_id: bandId,
    actor: { id: user.id, email: user.email },
    band_id: bandId,
    metadata: {
      name: band.name,
      from_user_id: user.id,
      to_user_id: transferTo,
      via: 'leave',
    },
  });

  return c.json({ ok: true });
}

export function handleDeleteBand(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const bandId = c.req.param('id') ?? '';
  if (!bandId) return c.json({ error: 'not_found' }, 404);

  const membership = stmts.findMembership.get(bandId, user.id);
  // Same existence-leak shape as the rest of this surface: non-members get
  // 404, members-who-aren't-owners get 403.
  if (!membership) return c.json({ error: 'not_found' }, 404);
  if (membership.role !== 'owner') return c.json({ error: 'forbidden' }, 403);

  const band = stmts.findBandById.get(bandId);
  if (!band) return c.json({ error: 'not_found' }, 404);

  const now = Math.floor(Date.now() / 1000);
  // Soft-delete the band PLUS cascade-soft-delete every live project and
  // revoke every live public link in one transaction. Without this cascade,
  // soft-deleted bands' projects continue to serve all the project routes
  // (get, rename, comment, public-link audio stream) until purge fires up
  // to 30 days later — the membership check passes because we deliberately
  // preserve memberships across soft-delete, and findProjectById only
  // filters projects.deleted_at, not the parent band's. Audio files stay
  // on disk; the purge sweep handles the irreversible cleanup.
  const cascade = db.transaction(() => {
    stmts.softDeleteBand.run(now, user.id, bandId);
    const projects = stmts.softDeleteProjectsForBand.run(now, user.id, bandId);
    const links = stmts.trashRevokePublicLinksForBand.run(now, bandId);
    return {
      projects_soft_deleted: projects.changes,
      public_links_revoked: links.changes,
    };
  })();

  recordAudit({
    action: 'band.soft_delete',
    resource_type: 'band',
    resource_id: bandId,
    actor: { id: user.id, email: user.email },
    band_id: bandId,
    metadata: {
      name: band.name,
      folder_id: band.folder_id,
      ...cascade,
    },
  });

  return c.json({ ok: true });
}
