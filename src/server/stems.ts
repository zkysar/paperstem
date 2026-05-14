import type { Context } from 'hono';
import { stmts } from './db.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';
import { renameItem, trashItem, untrashItem } from './storage.js';

const MAX_NAME_LENGTH = 200;

export async function handleRenameStem(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  const id = c.req.param('id') ?? '';
  if (!id) return c.json({ error: 'not_found' }, 404);

  const stem = stmts.findStemWithBandId.get(id);
  if (!stem) return c.json({ error: 'not_found' }, 404);

  const membership = stmts.findMembership.get(stem.band_id, user.id);
  if (!membership) return c.json({ error: 'not_found' }, 404);

  let body: { name?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'bad_request' }, 400);
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > MAX_NAME_LENGTH) {
    return c.json({ error: 'invalid_name' }, 400);
  }

  stmts.renameStem.run(name, id);

  try {
    await renameItem(stem.file_id, name);
  } catch (err) {
    console.warn('[stems] storage rename failed; DB updated', { id, err });
  }

  return c.json({ ok: true, name });
}

export async function handleDeleteStem(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  const id = c.req.param('id') ?? '';
  if (!id) return c.json({ error: 'not_found' }, 404);

  const stem = stmts.findStemWithBandId.get(id);
  if (!stem) return c.json({ error: 'not_found' }, 404);

  const membership = stmts.findMembership.get(stem.band_id, user.id);
  if (!membership) return c.json({ error: 'not_found' }, 404);

  const now = Math.floor(Date.now() / 1000);
  stmts.softDeleteStem.run(now, user.id, id);

  try {
    await trashItem(stem.file_id);
  } catch (err) {
    console.warn('[stems] storage trash failed; DB updated', { id, err });
  }

  return c.json({ ok: true });
}

export async function handleRestoreStem(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  const id = c.req.param('id') ?? '';
  if (!id) return c.json({ error: 'not_found' }, 404);

  const stem = stmts.findStemAnyState.get(id);
  if (!stem) return c.json({ error: 'not_found' }, 404);

  const membership = stmts.findMembership.get(stem.band_id, user.id);
  if (!membership) return c.json({ error: 'not_found' }, 404);

  if (stem.deleted_reason === 'drive_missing') {
    return c.json({ error: 'drive_missing' }, 409);
  }

  stmts.restoreStem.run(id);

  try {
    await untrashItem(stem.file_id);
  } catch (err) {
    console.warn('[stems] storage untrash failed; DB updated', { id, err });
  }

  return c.json({ ok: true });
}
