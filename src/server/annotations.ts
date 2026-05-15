import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { db, stmts, type AnnotationJoinedRow, type AnnotationReactionAggRow } from './db.js';
import { recordAudit } from './audit.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';
import { recordActivity } from './notifications.js';
import { fireImmediateMentionSends } from './notifications-flush.js';
import type { Annotation, Reaction } from '../shared/types.js';

const MAX_BODY_LENGTH = 32768;

function aggToReaction(row: AnnotationReactionAggRow): Reaction {
  return {
    emoji: row.emoji,
    count: row.count,
    user_ids: JSON.parse(row.user_ids_json) as string[],
    reacted_by_self: row.reacted_by_self === 1,
  };
}

function toApiAnnotation(
  row: AnnotationJoinedRow,
  replyCount: number,
  reactions: Reaction[],
): Annotation {
  return {
    id: row.id,
    project_id: row.project_id,
    user_id: row.user_id,
    user_email: row.user_email,
    user_display_name: row.user_display_name,
    start_ms: row.start_ms,
    end_ms: row.end_ms,
    body: row.body,
    starred: row.starred === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reply_count: replyCount,
    reactions,
  };
}

function validateStartEnd(
  start_ms: unknown,
  end_ms: unknown,
): { ok: true; start: number; end: number | null } | { ok: false } {
  if (typeof start_ms !== 'number' || !Number.isFinite(start_ms)) return { ok: false };
  if (!Number.isInteger(start_ms) || start_ms < 0) return { ok: false };
  let end: number | null;
  if (end_ms === null || end_ms === undefined) {
    end = null;
  } else if (typeof end_ms !== 'number' || !Number.isFinite(end_ms)) {
    return { ok: false };
  } else if (!Number.isInteger(end_ms) || end_ms <= start_ms) {
    return { ok: false };
  } else {
    end = end_ms;
  }
  return { ok: true, start: start_ms, end };
}

function validateBody(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  if (body.length < 1 || body.length > MAX_BODY_LENGTH) return null;
  return body;
}

export function handleListAnnotations(
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

  const rows = stmts.findAnnotationsForProject.all(projectId);
  const counts = stmts.countRepliesForProject.all(projectId);
  const countByAnn = new Map<string, number>();
  for (const row of counts) countByAnn.set(row.annotation_id, row.reply_count);

  const aggRows = stmts.findReactionsForProject.all({
    project_id: projectId,
    user_id: user.id,
  });
  const reactionsByAnn = new Map<string, Reaction[]>();
  for (const r of aggRows) {
    const list = reactionsByAnn.get(r.annotation_id) ?? [];
    list.push(aggToReaction(r));
    reactionsByAnn.set(r.annotation_id, list);
  }

  return c.json({
    annotations: rows.map((row) =>
      toApiAnnotation(
        row,
        countByAnn.get(row.id) ?? 0,
        reactionsByAnn.get(row.id) ?? [],
      ),
    ),
  });
}

type CreateAnnotationBody = {
  start_ms?: unknown;
  end_ms?: unknown;
  body?: unknown;
  starred?: unknown;
};

export async function handleCreateAnnotation(
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

  let body: CreateAnnotationBody;
  try {
    body = (await c.req.json()) as CreateAnnotationBody;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const range = validateStartEnd(body.start_ms, body.end_ms ?? null);
  if (!range.ok) return c.json({ error: 'invalid_input' }, 400);

  const text = validateBody(body.body);
  if (text === null) return c.json({ error: 'invalid_input' }, 400);

  const starred = body.starred === true ? 1 : 0;

  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  let activity: { mentionPendingIds: string[] } | undefined;
  const insertWithNotifications = db.transaction(() => {
    stmts.insertAnnotation.run(
      id,
      projectId,
      user.id,
      range.start,
      range.end,
      text,
      starred,
      now,
      now,
    );
    activity = recordActivity({
      kind: 'comment',
      sourceType: 'annotation',
      sourceId: id,
      projectId,
      authorId: user.id,
      body: text,
    });
  });
  insertWithNotifications();
  fireImmediateMentionSends(activity?.mentionPendingIds ?? []);

  const row = stmts.findAnnotationByIdJoined.get(id);
  if (!row) return c.json({ error: 'server_error' }, 500);
  return c.json({ annotation: toApiAnnotation(row, 0, []) }, 201);
}

type PatchAnnotationBody = {
  start_ms?: unknown;
  end_ms?: unknown;
  body?: unknown;
  starred?: unknown;
};

export async function handlePatchAnnotation(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  const id = c.req.param('id') ?? '';
  if (!id) return c.json({ error: 'not_found' }, 404);

  const existing = stmts.findAnnotationById.get(id);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const project = stmts.findProjectById.get(existing.project_id);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (!stmts.findMembership.get(project.band_id, user.id)) {
    return c.json({ error: 'not_found' }, 404);
  }
  if (existing.user_id !== user.id) {
    return c.json({ error: 'forbidden' }, 403);
  }

  let patch: PatchAnnotationBody;
  try {
    patch = (await c.req.json()) as PatchAnnotationBody;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const nextStartRaw =
    patch.start_ms === undefined ? existing.start_ms : patch.start_ms;
  const nextEndRaw =
    patch.end_ms === undefined ? existing.end_ms : patch.end_ms;

  const range = validateStartEnd(nextStartRaw, nextEndRaw);
  if (!range.ok) return c.json({ error: 'invalid_input' }, 400);

  let nextBody: string;
  if (patch.body === undefined) {
    nextBody = existing.body;
  } else {
    const text = validateBody(patch.body);
    if (text === null) return c.json({ error: 'invalid_input' }, 400);
    nextBody = text;
  }

  let nextStarred: number;
  if (patch.starred === undefined) {
    nextStarred = existing.starred;
  } else if (typeof patch.starred !== 'boolean') {
    return c.json({ error: 'invalid_input' }, 400);
  } else {
    nextStarred = patch.starred ? 1 : 0;
  }

  const now = Math.floor(Date.now() / 1000);
  stmts.updateAnnotation.run(
    range.start,
    range.end,
    nextBody,
    nextStarred,
    now,
    id,
  );

  const row = stmts.findAnnotationByIdJoined.get(id);
  if (!row) return c.json({ error: 'server_error' }, 500);
  const aggs = stmts.findReactionsForAnnotation.all({
    annotation_id: id,
    user_id: user.id,
  });
  const reactions = aggs.map(aggToReaction);
  const replyCount = stmts.countRepliesForAnnotation.get(id)?.n ?? 0;
  return c.json({ annotation: toApiAnnotation(row, replyCount, reactions) });
}

export function handleDeleteAnnotation(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const id = c.req.param('id') ?? '';
  if (!id) return c.json({ error: 'not_found' }, 404);

  const existing = stmts.findAnnotationById.get(id);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const project = stmts.findProjectById.get(existing.project_id);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (!stmts.findMembership.get(project.band_id, user.id)) {
    return c.json({ error: 'not_found' }, 404);
  }
  if (existing.user_id !== user.id) {
    return c.json({ error: 'forbidden' }, 403);
  }

  stmts.deleteAnnotation.run(id);

  recordAudit({
    action: 'annotation.hard_delete',
    resource_type: 'annotation',
    resource_id: id,
    actor: { id: user.id, email: user.email },
    band_id: project.band_id,
    metadata: {
      project_id: existing.project_id,
      start_ms: existing.start_ms,
      end_ms: existing.end_ms,
    },
  });

  return c.body(null, 204);
}

export const _internal = { validateStartEnd, validateBody };
