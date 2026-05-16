import type { Context } from 'hono';
import { stmts } from './db.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';

// Leaving the group is the first write endpoint in this surface. Owners
// can't leave because the band would be left without an owner; deleting
// the band (slice 3) is a separate, more destructive action.

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
