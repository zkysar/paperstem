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
