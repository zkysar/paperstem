import type { Context } from 'hono';
import { stmts } from './db.js';
import { recordAudit } from './audit.js';
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

  // Snapshot what's about to be hard-deleted BEFORE the purge runs. After
  // purgeProjectsForBand, the ON DELETE CASCADE on stems.project_id silently
  // wipes every stem row whose project was purged, with no deleted_by — this
  // is the gap that lets "stems completely vanish." Capture them here so the
  // audit log records who triggered the purge (the user who opened trash)
  // and which rows were affected.
  const projectsToPurge = stmts.findProjectsToPurge.all(bandId, cutoff);
  const cascadeStems = projectsToPurge.flatMap((p) =>
    stmts.findStemsForProjectAnyState.all(p.id),
  );
  const directStemsToPurge = stmts.findStemsToPurgeDirect.all(bandId, cutoff);

  // Order matters: projects first so cascade ON DELETE can sweep stems.
  stmts.purgeProjectsForBand.run(bandId, cutoff);
  stmts.purgeStemsForBand.run(bandId, cutoff);

  const actor = { id: user.id, email: user.email };
  for (const p of projectsToPurge) {
    recordAudit({
      action: 'project.purge',
      resource_type: 'project',
      resource_id: p.id,
      actor,
      band_id: bandId,
      metadata: {
        name: p.name,
        folder_id: p.folder_id,
        deleted_at: p.deleted_at,
        deleted_by: p.deleted_by,
        deleted_reason: p.deleted_reason,
        cutoff,
      },
    });
  }
  for (const s of cascadeStems) {
    recordAudit({
      action: 'stem.purge_cascade',
      resource_type: 'stem',
      resource_id: s.id,
      actor,
      band_id: bandId,
      metadata: {
        name: s.name,
        project_id: s.project_id,
        file_id: s.file_id,
        deleted_at: s.deleted_at,
        deleted_by: s.deleted_by,
        deleted_reason: s.deleted_reason,
      },
    });
  }
  // Stems whose own project survived the purge but the stem itself was
  // soft-deleted long enough ago to be purged directly.
  const cascadeStemIds = new Set(cascadeStems.map((s) => s.id));
  for (const s of directStemsToPurge) {
    if (cascadeStemIds.has(s.id)) continue;
    recordAudit({
      action: 'stem.purge',
      resource_type: 'stem',
      resource_id: s.id,
      actor,
      band_id: bandId,
      metadata: {
        name: s.name,
        project_id: s.project_id,
        file_id: s.file_id,
        deleted_at: s.deleted_at,
        deleted_by: s.deleted_by,
        deleted_reason: s.deleted_reason,
        cutoff,
      },
    });
  }

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
