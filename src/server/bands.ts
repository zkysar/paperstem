import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { stmts } from './db.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';
import { createFolder } from './storage.js';

// Leaving the group is the first write endpoint in this surface. Owners
// can't leave because the band would be left without an owner; deleting
// the band (slice 3+) is a separate, more destructive action.

const MAX_GROUP_NAME_LEN = 80;

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

  // A user can't own two bands with the same name — the canonical
  // collision check matches what bin/onboard-band.ts uses, so behavior
  // stays consistent across the CLI seeding flow and self-serve creation.
  const duplicate = stmts.findBandByNameAndOwner.get(name, user.id);
  if (duplicate) return c.json({ error: 'duplicate_name' }, 409);

  let folder: { id: string };
  try {
    folder = await createFolder(name);
  } catch (err) {
    console.error('[create-band] createFolder failed:', err);
    return c.json({ error: 'storage_failed' }, 500);
  }

  const bandId = randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);
  stmts.insertBand.run(bandId, name, folder.id, user.id, createdAt);
  stmts.insertMembership.run(bandId, user.id, 'owner', createdAt);

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
