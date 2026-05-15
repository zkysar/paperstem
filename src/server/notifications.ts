import { randomBytes } from 'node:crypto';
import { stmts } from './db.js';

const MENTION_TOKEN_RE = /@\[([a-z0-9-]+)\]/gi;
const VALID_UID_RE = /^[a-z0-9-]+$/i;

export function parseMentions(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(MENTION_TOKEN_RE)) {
    const uid = m[1];
    if (VALID_UID_RE.test(uid)) out.add(uid);
  }
  return Array.from(out);
}

export function resolveMentions(uids: string[], projectId: string): string[] {
  if (uids.length === 0) return [];
  const memberRows = stmts.findBandMemberIdsForProject.all(projectId) as Array<{ user_id: string }>;
  const memberSet = new Set(memberRows.map((r) => r.user_id));
  return uids.filter((u) => memberSet.has(u));
}

export function generateReplyToken(): string {
  return randomBytes(18).toString('base64url'); // 24 chars
}

export function recipientsForComment(projectId: string, authorId: string): string[] {
  const rows = stmts.findBandMemberIdsForProject.all(projectId) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id).filter((u) => u !== authorId);
}

export function recipientsForReply(annotationId: string, currentAuthorId: string): string[] {
  const ann = stmts.findAnnotationById.get(annotationId) as { user_id: string } | undefined;
  if (!ann) return [];
  const replies = stmts.findReplyParticipantsForAnnotation.all(annotationId) as Array<{ user_id: string }>;
  const set = new Set<string>([ann.user_id, ...replies.map((r) => r.user_id)]);
  set.delete(currentAuthorId);
  return Array.from(set);
}

export function recipientsForReaction(
  sourceType: 'annotation' | 'reply',
  sourceId: string,
  reactorId: string,
): string[] {
  if (sourceType === 'annotation') {
    const ann = stmts.findAnnotationById.get(sourceId) as { user_id: string } | undefined;
    if (!ann || ann.user_id === reactorId) return [];
    return [ann.user_id];
  } else {
    const rep = stmts.findReplyById.get(sourceId) as { user_id: string } | undefined;
    if (!rep || rep.user_id === reactorId) return [];
    return [rep.user_id];
  }
}
