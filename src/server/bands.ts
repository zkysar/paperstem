import { randomBytes, randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { db, stmts } from './db.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';
import { sendBandInvite } from './mailer.js';
import { createFolder } from './storage.js';

// Leaving the group is the first write endpoint in this surface. Owners
// can't leave because the band would be left without an owner; deleting
// the band (slice 3+) is a separate, more destructive action.

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

export function handleListBands(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
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
  const bandId = randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);
  const result = db.transaction(() => {
    const duplicate = stmts.findBandByNameAndOwner.get(name, user.id);
    if (duplicate) return { conflict: true } as const;
    stmts.insertBand.run(bandId, name, folder.id, user.id, createdAt);
    stmts.insertMembership.run(bandId, user.id, 'owner', createdAt);
    return { conflict: false } as const;
  })();
  if (result.conflict) return c.json({ error: 'duplicate_name' }, 409);

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
  const band = stmts.findBandById.get(bandId);
  if (!band) return c.json({ error: 'not_found' }, 404);
  if (name !== band.name) {
    const duplicate = stmts.findBandByNameAndOwner.get(name, user.id);
    if (duplicate && duplicate.id !== bandId) {
      return c.json({ error: 'duplicate_name' }, 409);
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

export function handleLeaveBand(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const bandId = c.req.param('id') ?? '';
  if (!bandId) return c.json({ error: 'not_found' }, 404);

  const membership = stmts.findMembership.get(bandId, user.id);
  // Hide the band's existence from non-members: same 404 shape as a missing
  // band, no leaking of "this band exists but you aren't in it".
  if (!membership) return c.json({ error: 'not_found' }, 404);
  if (membership.role === 'owner') {
    return c.json({ error: 'owner_cannot_leave' }, 409);
  }

  stmts.deleteMembership.run(bandId, user.id);
  return c.json({ ok: true });
}
