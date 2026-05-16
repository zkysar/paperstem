import { randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import {
  stmts,
  type AnnotationJoinedRow,
  type AnnotationReactionAggRow,
  type AnnotationReplyJoinedRow,
  type PublicLinkJoinedRow,
  type PublicLinkRow,
  type ReplyReactionAggRow,
  type SectionJoinedRow,
} from './db.js';
import { recordAudit } from './audit.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';
import { StorageNotFoundError, getFile } from './storage.js';

const TOKEN_PREFIX = 'pls_';
const TOKEN_BYTES = 24;
// base64url-encoding 24 bytes always yields exactly 32 chars (no padding).
// Locking the regex to that exact length means the pre-DB chokepoint
// rejects every malformed token — including length-varied fuzz attempts —
// without hitting the statement cache. If you ever change TOKEN_BYTES,
// derive the length here too.
const TOKEN_BODY_LEN = Math.ceil((TOKEN_BYTES * 4) / 3);
const TOKEN_RE = new RegExp(
  `^${TOKEN_PREFIX}[A-Za-z0-9_-]{${TOKEN_BODY_LEN}}$`,
);

const FORWARD_AUDIO_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
];

function mintToken(): string {
  return TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url');
}

type PublicAnnotation = {
  id: string;
  project_id: string;
  user_display_name: string | null;
  start_ms: number;
  end_ms: number | null;
  body: string;
  starred: boolean;
  created_at: number;
  updated_at: number;
  reply_count: number;
  reactions: PublicReaction[];
};

type PublicReaction = {
  emoji: string;
  count: number;
};

type PublicReply = {
  id: string;
  annotation_id: string;
  user_display_name: string | null;
  body: string;
  created_at: number;
  updated_at: number;
  reactions: PublicReaction[];
};

type PublicSection = {
  id: string;
  project_id: string;
  start_ms: number;
  song_name: string | null;
  label: string | null;
  source: 'manual' | 'auto';
  created_at: number;
  updated_at: number;
};

// Public payloads intentionally strip identifying fields that leak band
// roster information: user_email, user_id (which can be cross-referenced),
// and reaction.user_ids. Display names are kept so threads make sense to
// the viewer, but the underlying identities aren't enumerable.
function toPublicReaction(row: AnnotationReactionAggRow | ReplyReactionAggRow): PublicReaction {
  return { emoji: row.emoji, count: row.count };
}

function toPublicAnnotation(
  row: AnnotationJoinedRow,
  replyCount: number,
  reactions: PublicReaction[],
): PublicAnnotation {
  return {
    id: row.id,
    project_id: row.project_id,
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

function toPublicReply(
  row: AnnotationReplyJoinedRow,
  reactions: PublicReaction[],
): PublicReply {
  return {
    id: row.id,
    annotation_id: row.annotation_id,
    user_display_name: row.user_display_name,
    body: row.body,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reactions,
  };
}

function toPublicSection(row: SectionJoinedRow): PublicSection {
  return {
    id: row.id,
    project_id: row.project_id,
    start_ms: row.start_ms,
    song_name: row.song_name,
    label: row.label,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

type ResolvedLink =
  | { ok: true; link: PublicLinkRow }
  | { ok: false; status: 404 | 410 };

// Single chokepoint for "does this token resolve to a usable project?".
// Every public handler funnels through here so revocation, project
// soft-delete, and unknown-token cases are handled identically.
function resolveLink(rawToken: string): ResolvedLink {
  if (!TOKEN_RE.test(rawToken)) return { ok: false, status: 404 };
  const link = stmts.findPublicLinkByToken.get(rawToken);
  if (!link) return { ok: false, status: 404 };
  if (link.revoked_at !== null) return { ok: false, status: 410 };
  const project = stmts.findProjectById.get(link.project_id);
  if (!project) return { ok: false, status: 410 };
  return { ok: true, link };
}

function toListedLink(row: PublicLinkJoinedRow): {
  token: string;
  created_at: number;
  created_by_email: string | null;
  revoked_at: number | null;
  last_accessed_at: number | null;
} {
  return {
    token: row.token,
    created_at: row.created_at,
    created_by_email: row.created_by_email,
    revoked_at: row.revoked_at,
    last_accessed_at: row.last_accessed_at,
  };
}

// --- Management endpoints (authenticated) ---

export function handleListPublicLinks(
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

  const rows = stmts.findPublicLinksForProject.all(projectId);
  return c.json({ links: rows.map(toListedLink) });
}

export function handleCreatePublicLink(
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

  const token = mintToken();
  const now = Math.floor(Date.now() / 1000);
  stmts.insertPublicLink.run(token, projectId, user.id, now);

  recordAudit({
    action: 'public_link.create',
    resource_type: 'public_link',
    resource_id: token,
    actor: { id: user.id, email: user.email },
    band_id: project.band_id,
    metadata: { project_id: projectId },
  });

  return c.json(
    {
      link: {
        token,
        created_at: now,
        created_by_email: user.email,
        revoked_at: null,
        last_accessed_at: null,
      },
    },
    201,
  );
}

export function handleRevokePublicLink(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const token = c.req.param('token') ?? '';
  if (!TOKEN_RE.test(token)) return c.json({ error: 'not_found' }, 404);

  const link = stmts.findPublicLinkByToken.get(token);
  if (!link) return c.json({ error: 'not_found' }, 404);

  const project = stmts.findProjectAnyState.get(link.project_id);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (!stmts.findMembership.get(project.band_id, user.id)) {
    return c.json({ error: 'not_found' }, 404);
  }

  if (link.revoked_at !== null) return c.body(null, 204);

  const now = Math.floor(Date.now() / 1000);
  stmts.revokePublicLink.run(now, token);

  recordAudit({
    action: 'public_link.revoke',
    resource_type: 'public_link',
    resource_id: token,
    actor: { id: user.id, email: user.email },
    band_id: project.band_id,
    metadata: { project_id: link.project_id },
  });

  return c.body(null, 204);
}

// --- Public read endpoints (no auth, no session trust) ---

// Touch last_accessed_at at most once per minute per token to keep audit
// data useful without flooding the table on every audio Range request.
function touchAccess(token: string): void {
  const now = Math.floor(Date.now() / 1000);
  stmts.touchPublicLinkAccess.run(now, token, now - 60);
}

export function handleGetPublicProject(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const token = c.req.param('token') ?? '';
  const resolved = resolveLink(token);
  if (!resolved.ok) return c.json({ error: 'not_found' }, resolved.status);

  const project = stmts.findProjectById.get(resolved.link.project_id);
  if (!project) return c.json({ error: 'not_found' }, 410);

  const band = stmts.findBandById.get(project.band_id);
  const stems = stmts.findStemsForProject.all(project.id).map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    duration_ms: s.duration_ms,
    size_bytes: s.size_bytes,
    peaks: s.peaks,
  }));

  touchAccess(token);

  return c.json({
    project: {
      id: project.id,
      name: project.name,
      band_name: band?.name ?? null,
      recorded_on: project.recorded_on,
      created_at: project.created_at,
      updated_at: project.updated_at,
    },
    stems,
  });
}

export async function handleGetPublicAudio(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const token = c.req.param('token') ?? '';
  const stemId = c.req.param('stem_id') ?? '';
  const resolved = resolveLink(token);
  if (!resolved.ok) return c.json({ error: 'not_found' }, resolved.status);

  const stem = stmts.findStemWithBandId.get(stemId);
  // The token is the authority. The stem must belong to the project this
  // token grants access to — otherwise any valid token would unlock any
  // stem on the server.
  if (!stem || stem.project_id !== resolved.link.project_id) {
    return c.json({ error: 'not_found' }, 404);
  }

  const range = c.req.header('range');
  let upstream: Awaited<ReturnType<typeof getFile>>;
  try {
    upstream = await getFile(stem.file_id, range);
  } catch (err) {
    if (err instanceof StorageNotFoundError) {
      return c.json({ error: 'drive_missing' }, 410);
    }
    console.error('[public-audio] storage fetch failed', { stemId, err });
    return c.json({ error: 'upstream_error' }, 502);
  }

  // We deliberately do NOT touch last_accessed_at on every Range request —
  // a single play can produce dozens. The /api/public/links/:token GET that
  // bootstraps the page already touched.

  const headers = new Headers();
  for (const name of FORWARD_AUDIO_HEADERS) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, v);
  }
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');
  return new Response(upstream.body, { status: upstream.status, headers });
}

export function handleListPublicAnnotations(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const token = c.req.param('token') ?? '';
  const resolved = resolveLink(token);
  if (!resolved.ok) return c.json({ error: 'not_found' }, resolved.status);
  const projectId = resolved.link.project_id;

  const rows = stmts.findAnnotationsForProject.all(projectId);
  const counts = stmts.countRepliesForProject.all(projectId);
  const countByAnn = new Map<string, number>();
  for (const row of counts) countByAnn.set(row.annotation_id, row.reply_count);

  // We reuse the existing per-project reaction aggregator but pass an
  // empty user_id so reacted_by_self is always 0 — the field is dropped
  // from the public payload anyway. user_ids_json is also dropped.
  const aggRows = stmts.findReactionsForProject.all({
    project_id: projectId,
    user_id: '',
  });
  const reactionsByAnn = new Map<string, PublicReaction[]>();
  for (const r of aggRows) {
    const list = reactionsByAnn.get(r.annotation_id) ?? [];
    list.push(toPublicReaction(r));
    reactionsByAnn.set(r.annotation_id, list);
  }

  return c.json({
    annotations: rows.map((row) =>
      toPublicAnnotation(
        row,
        countByAnn.get(row.id) ?? 0,
        reactionsByAnn.get(row.id) ?? [],
      ),
    ),
  });
}

export function handleListPublicReplies(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const token = c.req.param('token') ?? '';
  const annotationId = c.req.param('annotationId') ?? '';
  const resolved = resolveLink(token);
  if (!resolved.ok) return c.json({ error: 'not_found' }, resolved.status);

  // The annotation must belong to the project this token grants access to.
  const ann = stmts.findAnnotationById.get(annotationId);
  if (!ann || ann.project_id !== resolved.link.project_id) {
    return c.json({ error: 'not_found' }, 404);
  }

  const rows = stmts.findRepliesForAnnotation.all(annotationId);
  const aggRows = stmts.findReactionsForReplies.all({
    annotation_id: annotationId,
    user_id: '',
  });
  const reactionsByReply = new Map<string, PublicReaction[]>();
  for (const r of aggRows) {
    const list = reactionsByReply.get(r.reply_id) ?? [];
    list.push(toPublicReaction(r));
    reactionsByReply.set(r.reply_id, list);
  }
  return c.json({
    replies: rows.map((r) => toPublicReply(r, reactionsByReply.get(r.id) ?? [])),
  });
}

export function handleListPublicSections(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const token = c.req.param('token') ?? '';
  const resolved = resolveLink(token);
  if (!resolved.ok) return c.json({ error: 'not_found' }, resolved.status);

  const rows = stmts.findSectionsForProject.all(resolved.link.project_id);
  return c.json({ sections: rows.map(toPublicSection) });
}

export const _internal = { TOKEN_RE, mintToken, resolveLink };
