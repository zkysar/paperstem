import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { stmts, type SectionJoinedRow } from './db.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';
import { findOrCreateSongRow, validateName } from './songs.js';
import type { Section } from '../shared/types.js';

const MAX_LABEL_LENGTH = 200;

function toApiSection(row: SectionJoinedRow): Section {
  return {
    id: row.id,
    project_id: row.project_id,
    start_ms: row.start_ms,
    song_id: row.song_id,
    song_name: row.song_name,
    label: row.label,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validateStartMs(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (!Number.isInteger(v) || v < 0) return null;
  return v;
}

function validateLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_LABEL_LENGTH) return null;
  return trimmed;
}

export function handleListSections(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const projectId = c.req.param('id') ?? '';
  if (!projectId) return c.json({ error: 'not_found' }, 404);

  const project = stmts.findProjectById.get(projectId);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (!stmts.findMembership.get(project.band_id, user.id)) {
    return c.json({ error: 'not_found' }, 404);
  }

  const rows = stmts.findSectionsForProject.all(projectId);
  return c.json({ sections: rows.map(toApiSection) });
}

type CreateSectionBody = {
  start_ms?: unknown;
  song_id?: unknown;
  song_name?: unknown;
  label?: unknown;
};

// Resolve a (song_id, label) pair from the request body. The popover sends
// one of:
//   - { song_id }                       → existing song picked from list
//   - { song_name }                     → user typed a new name; find-or-create
//   - { label }                         → free-text marker ("warmup")
//   - {}                                → unnamed boundary (allowed by schema)
// At most one of the three name-bearing inputs may be set at once; conflicts
// return invalid_input.
function resolveSongAndLabel(
  body: CreateSectionBody,
  bandId: string,
  userId: string,
):
  | { ok: true; songId: string | null; label: string | null }
  | { ok: false; reason: 'invalid_input' | 'not_found' } {
  const hasSongId = typeof body.song_id === 'string' && body.song_id.length > 0;
  const hasSongName = typeof body.song_name === 'string' && body.song_name.trim().length > 0;
  const hasLabel = typeof body.label === 'string' && body.label.trim().length > 0;
  const setCount = (hasSongId ? 1 : 0) + (hasSongName ? 1 : 0) + (hasLabel ? 1 : 0);
  if (setCount > 1) return { ok: false, reason: 'invalid_input' };

  if (hasSongId) {
    const songId = body.song_id as string;
    const song = stmts.findSongById.get(songId);
    if (!song || song.band_id !== bandId) {
      return { ok: false, reason: 'not_found' };
    }
    return { ok: true, songId, label: null };
  }
  if (hasSongName) {
    const row = findOrCreateSongRow(bandId, body.song_name as string, userId);
    if (!row) return { ok: false, reason: 'invalid_input' };
    return { ok: true, songId: row.id, label: null };
  }
  if (hasLabel) {
    const label = validateLabel(body.label);
    if (!label) return { ok: false, reason: 'invalid_input' };
    return { ok: true, songId: null, label };
  }
  return { ok: true, songId: null, label: null };
}

export async function handleCreateSection(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  const projectId = c.req.param('id') ?? '';
  if (!projectId) return c.json({ error: 'not_found' }, 404);

  const project = stmts.findProjectById.get(projectId);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (!stmts.findMembership.get(project.band_id, user.id)) {
    return c.json({ error: 'not_found' }, 404);
  }

  let body: CreateSectionBody;
  try {
    body = (await c.req.json()) as CreateSectionBody;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const startMs = validateStartMs(body.start_ms);
  if (startMs === null) return c.json({ error: 'invalid_input' }, 400);

  const resolved = resolveSongAndLabel(body, project.band_id, user.id);
  if (!resolved.ok) {
    const status = resolved.reason === 'not_found' ? 404 : 400;
    return c.json({ error: resolved.reason }, status);
  }

  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  stmts.insertSection.run(
    id,
    projectId,
    startMs,
    resolved.songId,
    resolved.label,
    'manual',
    now,
    user.id,
    now,
  );

  const row = stmts.findSectionByIdJoined.get(id);
  if (!row) return c.json({ error: 'server_error' }, 500);
  return c.json({ section: toApiSection(row) }, 201);
}

type PatchSectionBody = {
  start_ms?: unknown;
  song_id?: unknown;
  song_name?: unknown;
  label?: unknown;
  // When the client wants to explicitly clear the song/label (turning the
  // section into an unnamed boundary), it sends `clear_name: true`.
  // Without this flag, omitting song_id/song_name/label leaves the
  // current value untouched.
  clear_name?: unknown;
};

export async function handlePatchSection(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  const id = c.req.param('id') ?? '';
  if (!id) return c.json({ error: 'not_found' }, 404);

  const existing = stmts.findSectionById.get(id);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const project = stmts.findProjectById.get(existing.project_id);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (!stmts.findMembership.get(project.band_id, user.id)) {
    return c.json({ error: 'not_found' }, 404);
  }

  let patch: PatchSectionBody;
  try {
    patch = (await c.req.json()) as PatchSectionBody;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  let nextStartMs = existing.start_ms;
  if (patch.start_ms !== undefined) {
    const sm = validateStartMs(patch.start_ms);
    if (sm === null) return c.json({ error: 'invalid_input' }, 400);
    nextStartMs = sm;
  }

  let nextSongId = existing.song_id;
  let nextLabel = existing.label;

  const namePatchPresent =
    patch.song_id !== undefined ||
    patch.song_name !== undefined ||
    patch.label !== undefined ||
    patch.clear_name === true;

  if (namePatchPresent) {
    if (patch.clear_name === true) {
      nextSongId = null;
      nextLabel = null;
    } else {
      const resolved = resolveSongAndLabel(
        {
          song_id: patch.song_id,
          song_name: patch.song_name,
          label: patch.label,
        },
        project.band_id,
        user.id,
      );
      if (!resolved.ok) {
        const status = resolved.reason === 'not_found' ? 404 : 400;
        return c.json({ error: resolved.reason }, status);
      }
      nextSongId = resolved.songId;
      nextLabel = resolved.label;
    }
  }

  const now = Math.floor(Date.now() / 1000);
  stmts.updateSection.run(nextStartMs, nextSongId, nextLabel, now, id);

  const row = stmts.findSectionByIdJoined.get(id);
  if (!row) return c.json({ error: 'server_error' }, 500);
  return c.json({ section: toApiSection(row) });
}

export function handleDeleteSection(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const id = c.req.param('id') ?? '';
  if (!id) return c.json({ error: 'not_found' }, 404);

  const existing = stmts.findSectionById.get(id);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const project = stmts.findProjectById.get(existing.project_id);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (!stmts.findMembership.get(project.band_id, user.id)) {
    return c.json({ error: 'not_found' }, 404);
  }

  stmts.deleteSection.run(id);
  return c.body(null, 204);
}

// GET /api/bands/:id/songs/usage — returns rows of { project_id, song_id }
// for every (project, song) pair in the band. Used by the FilePicker
// chip-rail filter to compute "which projects contain Song X" client-side
// without one fetch per chip-click.
export function handleListSongUsage(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const bandId = c.req.param('id') ?? '';
  if (!bandId) return c.json({ error: 'not_found' }, 404);

  if (!stmts.findMembership.get(bandId, user.id)) {
    return c.json({ error: 'not_found' }, 404);
  }

  const rows = stmts.findSongUsageForBand.all(bandId);
  return c.json({ usage: rows });
}

export const _internal = { validateStartMs, validateLabel, resolveSongAndLabel };
