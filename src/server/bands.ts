import type { Context } from 'hono';
import { stmts } from './db.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';

export function handleListBands(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const rows = stmts.findBandsForUser.all(user.id);
  const bands = rows.map((b) => ({
    id: b.id,
    name: b.name,
    drive_folder_id: b.drive_folder_id,
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
      drive_folder_id: band.drive_folder_id,
      owner_user_id: band.owner_user_id,
      created_at: band.created_at,
    },
    members,
  });
}
