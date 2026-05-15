import type { Context } from 'hono';
import { stmts } from './db.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';

const MAX_EMOJI_BYTES = 32;

function validateEmoji(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length < 1) return null;
  if (new TextEncoder().encode(raw).length > MAX_EMOJI_BYTES) return null;
  return raw;
}

async function readEmoji(c: Context): Promise<string | null> {
  try {
    const body = (await c.req.json()) as { emoji?: unknown };
    return validateEmoji(body.emoji);
  } catch {
    return null;
  }
}

// DELETE requests can't reliably carry bodies through every proxy (Fly's edge,
// CDNs, ALBs), so the delete handlers read the emoji from the query string
// instead. Both forms are accepted for forward compatibility.
function readEmojiQuery(c: Context): string | null {
  const q = c.req.query('emoji');
  return validateEmoji(q);
}

function assertAnnotationAccessible(
  c: Context<{ Variables: AuthVariables }>,
  annotationId: string,
): { ok: true; userId: string } | { ok: false; res: Response } {
  const user = requireUser(c);
  const ann = stmts.findAnnotationById.get(annotationId);
  if (!ann) return { ok: false, res: c.json({ error: 'not_found' }, 404) };
  const project = stmts.findProjectById.get(ann.project_id);
  if (!project) return { ok: false, res: c.json({ error: 'not_found' }, 404) };
  if (!stmts.findMembership.get(project.band_id, user.id)) {
    return { ok: false, res: c.json({ error: 'not_found' }, 404) };
  }
  return { ok: true, userId: user.id };
}

function assertReplyAccessible(
  c: Context<{ Variables: AuthVariables }>,
  replyId: string,
): { ok: true; userId: string } | { ok: false; res: Response } {
  const user = requireUser(c);
  const reply = stmts.findReplyById.get(replyId);
  if (!reply) return { ok: false, res: c.json({ error: 'not_found' }, 404) };
  const ann = stmts.findAnnotationById.get(reply.annotation_id);
  if (!ann) return { ok: false, res: c.json({ error: 'not_found' }, 404) };
  const project = stmts.findProjectById.get(ann.project_id);
  if (!project) return { ok: false, res: c.json({ error: 'not_found' }, 404) };
  if (!stmts.findMembership.get(project.band_id, user.id)) {
    return { ok: false, res: c.json({ error: 'not_found' }, 404) };
  }
  return { ok: true, userId: user.id };
}

export async function handleAddAnnotationReaction(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const annId = c.req.param('annotationId') ?? '';
  if (!annId) return c.json({ error: 'not_found' }, 404);
  const access = assertAnnotationAccessible(c, annId);
  if (!access.ok) return access.res;

  const emoji = await readEmoji(c);
  if (!emoji) return c.json({ error: 'invalid_input' }, 400);

  stmts.insertReaction.run(
    annId,
    access.userId,
    emoji,
    Math.floor(Date.now() / 1000),
  );
  return c.json({ ok: true });
}

export async function handleRemoveAnnotationReaction(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const annId = c.req.param('annotationId') ?? '';
  if (!annId) return c.json({ error: 'not_found' }, 404);
  const access = assertAnnotationAccessible(c, annId);
  if (!access.ok) return access.res;

  const emoji = readEmojiQuery(c) ?? (await readEmoji(c));
  if (!emoji) return c.json({ error: 'invalid_input' }, 400);

  stmts.deleteReaction.run(annId, access.userId, emoji);
  return c.body(null, 204);
}

export async function handleAddReplyReaction(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const replyId = c.req.param('replyId') ?? '';
  if (!replyId) return c.json({ error: 'not_found' }, 404);
  const access = assertReplyAccessible(c, replyId);
  if (!access.ok) return access.res;

  const emoji = await readEmoji(c);
  if (!emoji) return c.json({ error: 'invalid_input' }, 400);

  stmts.insertReplyReaction.run(
    replyId,
    access.userId,
    emoji,
    Math.floor(Date.now() / 1000),
  );
  return c.json({ ok: true });
}

export async function handleRemoveReplyReaction(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const replyId = c.req.param('replyId') ?? '';
  if (!replyId) return c.json({ error: 'not_found' }, 404);
  const access = assertReplyAccessible(c, replyId);
  if (!access.ok) return access.res;

  const emoji = readEmojiQuery(c) ?? (await readEmoji(c));
  if (!emoji) return c.json({ error: 'invalid_input' }, 400);

  stmts.deleteReplyReaction.run(replyId, access.userId, emoji);
  return c.body(null, 204);
}
