import { randomBytes, randomUUID } from 'node:crypto';
import { db, stmts } from './db.js';

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

export interface RecordActivityArgs {
  kind: 'comment' | 'reply' | 'reaction';
  sourceType: 'annotation' | 'reply';
  sourceId: string;
  projectId: string;
  authorId: string;
  body: string;
}

function nameLookupForUids(uids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (uids.length === 0) return out;
  const placeholders = uids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id, COALESCE(display_name, email) AS name FROM users WHERE id IN (${placeholders})`)
    .all(...uids) as Array<{ id: string; name: string }>;
  for (const r of rows) out.set(r.id, r.name);
  return out;
}

function previewFor(body: string, names: Map<string, string>): string {
  const resolved = body.replace(/@\[([a-z0-9-]+)\]/gi, (_, uid) => {
    const name = names.get(uid);
    return name ? `@${name}` : '@unknown';
  });
  return resolved.slice(0, 140);
}

export function recordActivity(args: RecordActivityArgs): { mentionRowIds: string[]; mentionPendingIds: string[] } {
  const { kind, sourceType, sourceId, projectId, authorId, body } = args;
  const project = db.prepare('SELECT band_id FROM projects WHERE id = ?').get(projectId) as { band_id: string } | undefined;
  if (!project) throw new Error('recordActivity: project not found');
  const bandId = project.band_id;
  const now = Math.floor(Date.now() / 1000);

  const tokens = parseMentions(body);
  const mentionTargets = resolveMentions(tokens, projectId).filter((u) => u !== authorId);

  let baseRecipients: string[] = [];
  if (kind === 'comment') baseRecipients = recipientsForComment(projectId, authorId);
  else if (kind === 'reply') {
    const reply = stmts.findReplyById.get(sourceId) as { annotation_id: string } | undefined;
    if (reply) baseRecipients = recipientsForReply(reply.annotation_id, authorId);
  } else baseRecipients = recipientsForReaction(sourceType, sourceId, authorId);

  const filteredBase = applyPrefsFilter(baseRecipients, bandId, kind);
  const filteredMentions = applyPrefsFilter(mentionTargets, bandId, 'mention');

  const mentionRowIds: string[] = [];
  for (const target of filteredMentions) {
    const id = randomUUID();
    stmts.insertMention.run(id, sourceType, sourceId, projectId, authorId, target, now);
    mentionRowIds.push(id);
  }

  const mentionSet = new Set(filteredMentions);
  type Enqueue = { recipientId: string; kind: PendingKind };
  const enqueue: Enqueue[] = [];
  for (const r of filteredMentions) enqueue.push({ recipientId: r, kind: 'mention' });
  for (const r of filteredBase) {
    if (mentionSet.has(r)) continue;
    enqueue.push({ recipientId: r, kind });
  }

  const names = nameLookupForUids(tokens);
  const preview = previewFor(body, names);

  const mentionPendingIds: string[] = [];
  for (const e of enqueue) {
    const pendingId = randomUUID();
    stmts.insertPendingNotification.run(
      pendingId,
      e.recipientId,
      e.kind,
      projectId,
      sourceType,
      sourceId,
      authorId,
      preview,
      generateReplyToken(),
      now,
    );
    if (e.kind === 'mention') mentionPendingIds.push(pendingId);
  }

  return { mentionRowIds, mentionPendingIds };
}
