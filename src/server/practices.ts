import type { Context } from 'hono';
import { stmts } from './db.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';

export function handleListPractices(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const bandId = c.req.query('band_id') ?? '';
  if (!bandId) return c.json({ error: 'not_found' }, 404);

  const membership = stmts.findMembership.get(bandId, user.id);
  if (!membership) return c.json({ error: 'not_found' }, 404);

  const rows = stmts.findPracticesForBand.all(bandId);
  const practices = rows.map((p) => ({
    id: p.id,
    name: p.name,
    recorded_on: p.recorded_on,
    bpm: p.bpm,
    reference_stem: p.reference_stem,
    created_at: p.created_at,
    updated_at: p.updated_at,
  }));
  return c.json({ practices });
}

export function handleGetPractice(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const id = c.req.param('id') ?? '';
  if (!id) return c.json({ error: 'not_found' }, 404);

  const practice = stmts.findPracticeById.get(id);
  if (!practice) return c.json({ error: 'not_found' }, 404);

  const membership = stmts.findMembership.get(practice.band_id, user.id);
  if (!membership) return c.json({ error: 'not_found' }, 404);

  const stems = stmts.findStemsForPractice.all(id).map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    duration_ms: s.duration_ms,
    size_bytes: s.size_bytes,
  }));

  return c.json({
    practice: {
      id: practice.id,
      band_id: practice.band_id,
      name: practice.name,
      recorded_on: practice.recorded_on,
      drive_folder_id: practice.drive_folder_id,
      bpm: practice.bpm,
      reference_stem: practice.reference_stem,
      notes: practice.notes,
      created_at: practice.created_at,
      created_by: practice.created_by,
      updated_at: practice.updated_at,
    },
    stems,
  });
}
