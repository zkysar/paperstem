import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import {
  stmts,
  type AnnotationReplyJoinedRow,
  type ReplyReactionAggRow,
} from './db.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';
import type { AnnotationReply, Reaction } from '../shared/types.js';

const MAX_BODY_LENGTH = 32768;

function aggToReaction(row: ReplyReactionAggRow): Reaction {
  return {
    emoji: row.emoji,
    count: row.count,
    user_ids: JSON.parse(row.user_ids_json) as string[],
    reacted_by_self: row.reacted_by_self === 1,
  };
}

function toApiReply(
  row: AnnotationReplyJoinedRow,
  reactions: Reaction[],
): AnnotationReply {
  return {
    id: row.id,
    annotation_id: row.annotation_id,
    user_id: row.user_id,
    user_email: row.user_email,
    user_display_name: row.user_display_name,
    body: row.body,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reactions,
  };
}

function validateBody(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  if (body.length < 1 || body.length > MAX_BODY_LENGTH) return null;
  return body;
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

export function handleListReplies(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const annId = c.req.param('annotationId') ?? '';
  if (!annId) return c.json({ error: 'not_found' }, 404);
  const access = assertAnnotationAccessible(c, annId);
  if (!access.ok) return access.res;

  const rows = stmts.findRepliesForAnnotation.all(annId);
  const aggRows = stmts.findReactionsForReplies.all({ annotation_id: annId, user_id: access.userId });
  const reactionsByReply = new Map<string, Reaction[]>();
  for (const r of aggRows) {
    const list = reactionsByReply.get(r.reply_id) ?? [];
    list.push(aggToReaction(r));
    reactionsByReply.set(r.reply_id, list);
  }
  const replies = rows.map((r) =>
    toApiReply(r, reactionsByReply.get(r.id) ?? []),
  );
  return c.json({ replies });
}

export async function handleCreateReply(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const annId = c.req.param('annotationId') ?? '';
  if (!annId) return c.json({ error: 'not_found' }, 404);
  const access = assertAnnotationAccessible(c, annId);
  if (!access.ok) return access.res;

  let body: { body?: unknown };
  try {
    body = (await c.req.json()) as { body?: unknown };
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const text = validateBody(body.body);
  if (text === null) return c.json({ error: 'invalid_input' }, 400);

  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  stmts.insertReply.run(id, annId, access.userId, text, now, now);

  const row = stmts.findReplyByIdJoined.get(id);
  if (!row) return c.json({ error: 'server_error' }, 500);
  return c.json({ reply: toApiReply(row, []) }, 201);
}

export async function handlePatchReply(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  const id = c.req.param('id') ?? '';
  if (!id) return c.json({ error: 'not_found' }, 404);

  const existing = stmts.findReplyById.get(id);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const ann = stmts.findAnnotationById.get(existing.annotation_id);
  if (!ann) return c.json({ error: 'not_found' }, 404);
  const project = stmts.findProjectById.get(ann.project_id);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (!stmts.findMembership.get(project.band_id, user.id)) {
    return c.json({ error: 'not_found' }, 404);
  }
  if (existing.user_id !== user.id) {
    return c.json({ error: 'forbidden' }, 403);
  }

  let patch: { body?: unknown };
  try {
    patch = (await c.req.json()) as { body?: unknown };
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const text = validateBody(patch.body);
  if (text === null) return c.json({ error: 'invalid_input' }, 400);

  const now = Math.floor(Date.now() / 1000);
  stmts.updateReply.run(text, now, id);

  const row = stmts.findReplyByIdJoined.get(id);
  if (!row) return c.json({ error: 'server_error' }, 500);

  const aggRows = stmts.findReactionsForReplies.all(
    { annotation_id: existing.annotation_id, user_id: user.id },
  );
  const reactions = aggRows
    .filter((r) => r.reply_id === id)
    .map(aggToReaction);

  return c.json({ reply: toApiReply(row, reactions) });
}

export function handleDeleteReply(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const id = c.req.param('id') ?? '';
  if (!id) return c.json({ error: 'not_found' }, 404);

  const existing = stmts.findReplyById.get(id);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const ann = stmts.findAnnotationById.get(existing.annotation_id);
  if (!ann) return c.json({ error: 'not_found' }, 404);
  const project = stmts.findProjectById.get(ann.project_id);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (!stmts.findMembership.get(project.band_id, user.id)) {
    return c.json({ error: 'not_found' }, 404);
  }
  if (existing.user_id !== user.id) {
    return c.json({ error: 'forbidden' }, 403);
  }

  stmts.deleteReply.run(id);
  return c.body(null, 204);
}
