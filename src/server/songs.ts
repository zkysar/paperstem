import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { db, stmts, type SongRow, type SongWithUseCountRow } from './db.js';
import { recordAudit } from './audit.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';
import type { Song } from '../shared/types.js';

const MAX_NAME_LENGTH = 200;

export function normalizeName(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_NAME_LENGTH) return null;
  return trimmed;
}

function toApiSong(row: SongWithUseCountRow): Song {
  return {
    id: row.id,
    band_id: row.band_id,
    name: row.name,
    created_at: row.created_at,
    use_count: row.use_count,
  };
}

// Find an existing song by normalized name in the band, or create one and
// return the new row. Used by both the explicit POST .../songs endpoint
// and the inline song_name path in section creation/patch, so dedup
// behaves identically whichever route the client takes.
export function findOrCreateSongRow(
  bandId: string,
  rawName: string,
  userId: string,
): SongRow | null {
  const name = validateName(rawName);
  if (!name) return null;
  const norm = normalizeName(name);
  const existing = stmts.findSongByBandAndNameNorm.get(bandId, norm);
  if (existing) return existing;
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  stmts.insertSong.run(id, bandId, name, norm, now, userId);
  return stmts.findSongById.get(id) ?? null;
}

export function handleListSongs(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const bandId = c.req.param('id') ?? '';
  if (!bandId) return c.json({ error: 'not_found' }, 404);

  if (!stmts.findMembership.get(bandId, user.id)) {
    return c.json({ error: 'not_found' }, 404);
  }

  const rows = stmts.findSongsForBandWithUseCount.all(bandId);
  return c.json({ songs: rows.map(toApiSong) });
}

type CreateSongBody = { name?: unknown };

export async function handleCreateSong(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  const bandId = c.req.param('id') ?? '';
  if (!bandId) return c.json({ error: 'not_found' }, 404);

  if (!stmts.findMembership.get(bandId, user.id)) {
    return c.json({ error: 'not_found' }, 404);
  }

  let body: CreateSongBody;
  try {
    body = (await c.req.json()) as CreateSongBody;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const name = validateName(body.name);
  if (!name) return c.json({ error: 'invalid_input' }, 400);

  const row = findOrCreateSongRow(bandId, name, user.id);
  if (!row) return c.json({ error: 'server_error' }, 500);

  const withUseCount = stmts.findSongByIdWithUseCount.get(row.id);
  if (!withUseCount) return c.json({ error: 'server_error' }, 500);
  return c.json({ song: toApiSong(withUseCount) }, 201);
}

type PatchSongBody = { name?: unknown };

export async function handlePatchSong(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  const id = c.req.param('id') ?? '';
  if (!id) return c.json({ error: 'not_found' }, 404);

  const existing = stmts.findSongById.get(id);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  if (!stmts.findMembership.get(existing.band_id, user.id)) {
    return c.json({ error: 'not_found' }, 404);
  }

  let body: PatchSongBody;
  try {
    body = (await c.req.json()) as PatchSongBody;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const name = validateName(body.name);
  if (!name) return c.json({ error: 'invalid_input' }, 400);

  const newNorm = normalizeName(name);
  if (newNorm !== existing.name_norm) {
    const conflict = stmts.findSongByBandAndNameNorm.get(
      existing.band_id,
      newNorm,
    );
    if (conflict && conflict.id !== id) {
      // Return enough context for the client to offer a merge prompt
      // without an extra round-trip.
      return c.json(
        {
          error: 'name_conflict',
          existing_song_id: conflict.id,
          existing_song_name: conflict.name,
        },
        409,
      );
    }
  }

  stmts.renameSong.run(name, newNorm, id);

  recordAudit({
    action: 'song.rename',
    resource_type: 'song',
    resource_id: id,
    actor: { id: user.id, email: user.email },
    band_id: existing.band_id,
    metadata: { from: existing.name, to: name },
  });

  const updated = stmts.findSongByIdWithUseCount.get(id);
  if (!updated) return c.json({ error: 'server_error' }, 500);
  return c.json({ song: toApiSong(updated) });
}

type MergeSongBody = { into?: unknown };

export async function handleMergeSong(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  const id = c.req.param('id') ?? '';
  if (!id) return c.json({ error: 'not_found' }, 404);

  const loser = stmts.findSongById.get(id);
  if (!loser) return c.json({ error: 'not_found' }, 404);

  if (!stmts.findMembership.get(loser.band_id, user.id)) {
    return c.json({ error: 'not_found' }, 404);
  }

  let body: MergeSongBody;
  try {
    body = (await c.req.json()) as MergeSongBody;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const intoId = typeof body.into === 'string' ? body.into : '';
  if (!intoId || intoId === id) {
    return c.json({ error: 'invalid_input' }, 400);
  }

  const winner = stmts.findSongById.get(intoId);
  if (!winner) return c.json({ error: 'not_found' }, 404);
  if (winner.band_id !== loser.band_id) {
    // Cross-band merge would corrupt the catalog; refuse it.
    return c.json({ error: 'invalid_input' }, 400);
  }

  // Repoint + delete must be atomic so that two concurrent merges (A→B
  // racing B→A) can't interleave to orphan sections or surface as a 500
  // from a unique-index violation. better-sqlite3 transactions are
  // synchronous and lock the DB, which is the behaviour we want here.
  // The membership re-check inside the txn closes the small TOCTOU
  // window between the outer membership lookup and the writes — if the
  // caller's membership was revoked in flight, the merge aborts.
  try {
    db.transaction(() => {
      const stillMember = stmts.findMembership.get(loser.band_id, user.id);
      if (!stillMember) throw new Error('unauthorized');
      const stillLoser = stmts.findSongById.get(loser.id);
      const stillWinner = stmts.findSongById.get(winner.id);
      if (!stillLoser || !stillWinner) throw new Error('vanished');
      if (stillWinner.band_id !== stillLoser.band_id) throw new Error('drift');
      stmts.repointSectionsToSong.run(stillWinner.id, stillLoser.id);
      stmts.deleteSong.run(stillLoser.id);
    })();
  } catch (err) {
    if (err instanceof Error && err.message === 'unauthorized') {
      return c.json({ error: 'not_found' }, 404);
    }
    console.error('[songs] merge transaction failed', err);
    return c.json({ error: 'conflict' }, 409);
  }

  recordAudit({
    action: 'song.merge',
    resource_type: 'song',
    resource_id: loser.id,
    actor: { id: user.id, email: user.email },
    band_id: loser.band_id,
    metadata: {
      merged_from_name: loser.name,
      merged_into_id: winner.id,
      merged_into_name: winner.name,
    },
  });

  const updated = stmts.findSongByIdWithUseCount.get(winner.id);
  if (!updated) return c.json({ error: 'server_error' }, 500);
  return c.json({ song: toApiSong(updated) });
}

export function handleDeleteSong(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const id = c.req.param('id') ?? '';
  if (!id) return c.json({ error: 'not_found' }, 404);

  const existing = stmts.findSongById.get(id);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  if (!stmts.findMembership.get(existing.band_id, user.id)) {
    return c.json({ error: 'not_found' }, 404);
  }

  // ON DELETE SET NULL on sections.song_id means existing section rows
  // survive as unnamed boundaries — the catalog goes away, the timeline
  // markers stay. Re-naming them is a follow-up the user can do in the
  // section popover.
  stmts.deleteSong.run(id);

  recordAudit({
    action: 'song.delete',
    resource_type: 'song',
    resource_id: id,
    actor: { id: user.id, email: user.email },
    band_id: existing.band_id,
    metadata: { name: existing.name },
  });

  return c.body(null, 204);
}

export const _internal = { validateName, normalizeName, findOrCreateSongRow };
