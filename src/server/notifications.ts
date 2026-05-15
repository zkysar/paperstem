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

export type PendingKind = 'comment' | 'reply' | 'mention' | 'reaction';

export type EffectivePrefs = {
  user_id: string;
  email_mentions: number;
  email_project_activity: 'batched' | 'daily' | 'off';
  email_thread_activity: 'batched' | 'daily' | 'off';
  digest_hour_local: number;
  timezone: string;
};

const DEFAULT_PREFS: Omit<EffectivePrefs, 'user_id'> = {
  email_mentions: 1,
  email_project_activity: 'batched',
  email_thread_activity: 'batched',
  digest_hour_local: 8,
  timezone: 'UTC',
};

export function getEffectivePrefs(userId: string): EffectivePrefs {
  const row = stmts.findNotificationPrefs.get(userId) as EffectivePrefs | undefined;
  return row ?? { user_id: userId, ...DEFAULT_PREFS };
}

export function applyPrefsFilter(
  recipients: string[],
  bandId: string,
  kind: PendingKind,
): string[] {
  return recipients.filter((uid) => {
    if (stmts.findBandMute.get(uid, bandId)) return false;
    const prefs = getEffectivePrefs(uid);
    if (kind === 'mention') return prefs.email_mentions === 1;
    const pref = kind === 'reply' ? prefs.email_thread_activity : prefs.email_project_activity;
    return pref !== 'off';
  });
}
