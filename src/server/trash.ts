import type { Context } from 'hono';
import { stmts } from './db.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';

const PURGE_AFTER_SECONDS = 30 * 24 * 60 * 60;

export function handleListTrash(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const bandId = c.req.param('id') ?? '';
  if (!bandId) return c.json({ error: 'not_found' }, 404);

  const membership = stmts.findMembership.get(bandId, user.id);
  if (!membership) return c.json({ error: 'not_found' }, 404);

  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - PURGE_AFTER_SECONDS;

  // Order matters: projects first so cascade ON DELETE can sweep stems.
  stmts.purgeProjectsForBand.run(bandId, cutoff);
  stmts.purgeStemsForBand.run(bandId, cutoff);

  const projects = stmts.findTrashedProjectsForBand.all(bandId).map((p) => ({
    id: p.id,
    name: p.name,
    deleted_at: p.deleted_at,
    deleted_by_email: p.deleted_by_email,
    deleted_reason: p.deleted_reason,
  }));

  const stems = stmts.findTrashedStemsForBand.all(bandId).map((s) => ({
    id: s.id,
    name: s.name,
    project_id: s.project_id,
    project_name: s.project_name,
    deleted_at: s.deleted_at,
    deleted_by_email: s.deleted_by_email,
    deleted_reason: s.deleted_reason,
  }));

  return c.json({ projects, stems });
}
