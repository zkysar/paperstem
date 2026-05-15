import { stmts, db, type PendingNotificationRow } from './db.js';
import {
  sendMentionEmail, sendDigestEmail,
  type DigestEvent, type DigestProjectGroup,
} from './mailer.js';
import { getEffectivePrefs } from './notifications.js';

export interface FlushContext {
  appBaseUrl: string;
  inboundDomain: string;
}

export interface FlushOptions extends FlushContext {
  mode: 'batched' | 'daily';
}

const MAX_ATTEMPTS = 3;

function nowSec(): number { return Math.floor(Date.now() / 1000); }

function commentLink(ctx: FlushContext, row: PendingNotificationRow): string {
  const anchor = row.source_type === 'annotation' ? `cmt_${row.source_id}` : `rep_${row.source_id}`;
  return `${ctx.appBaseUrl}/#p=${row.project_id}&fc=${anchor}`;
}

function muteBandLink(ctx: FlushContext, bandId: string): string {
  return `${ctx.appBaseUrl}/#settings=notifications&mute=${bandId}`;
}

function settingsLink(ctx: FlushContext): string {
  return `${ctx.appBaseUrl}/#settings=notifications`;
}

function fetchUserEmail(userId: string): string | null {
  const row = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined;
  return row?.email ?? null;
}

function fetchUserName(userId: string): string {
  const row = db.prepare('SELECT email, display_name FROM users WHERE id = ?').get(userId) as { email: string; display_name: string | null } | undefined;
  return row?.display_name ?? row?.email ?? 'someone';
}

function fetchProjectName(projectId: string): string {
  const row = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string } | undefined;
  return row?.name ?? '(deleted project)';
}

function fetchProjectBandId(projectId: string): string | null {
  const row = db.prepare('SELECT band_id FROM projects WHERE id = ?').get(projectId) as { band_id: string } | undefined;
  return row?.band_id ?? null;
}

export async function flushOne(id: string, ctx: FlushContext): Promise<void> {
  const row = stmts.findPendingById.get(id) as PendingNotificationRow | undefined;
  if (!row || row.sent_at !== null) return;
  const to = fetchUserEmail(row.recipient_id);
  if (!to) {
    stmts.markPendingSent.run(nowSec(), row.id);
    return;
  }
  const authorName = fetchUserName(row.author_user_id);
  const projectName = fetchProjectName(row.project_id);
  const bandId = fetchProjectBandId(row.project_id);
  try {
    if (row.kind === 'mention') {
      await sendMentionEmail({
        to, authorName, projectName, preview: row.preview,
        commentLink: commentLink(ctx, row),
        muteBandLink: bandId ? muteBandLink(ctx, bandId) : settingsLink(ctx),
        settingsLink: settingsLink(ctx),
        replyToken: row.reply_token ?? '',
        inboundDomain: ctx.inboundDomain,
      });
    } else {
      const event: DigestEvent = { authorName, preview: row.preview };
      const groups: DigestProjectGroup[] = [{ projectName, events: [event] }];
      await sendDigestEmail({
        to, daily: false, groups,
        linkBuilder: () => commentLink(ctx, row),
        muteBandLink: bandId ? muteBandLink(ctx, bandId) : undefined,
        settingsLink: settingsLink(ctx),
        representativeReplyToken: row.reply_token ?? '',
        inboundDomain: ctx.inboundDomain,
      });
    }
    stmts.markPendingSent.run(nowSec(), row.id);
  } catch {
    stmts.bumpPendingAttempt.run(row.id);
    const after = stmts.findPendingById.get(row.id) as PendingNotificationRow | undefined;
    if (after && after.send_attempts >= MAX_ATTEMPTS) {
      stmts.markPendingSent.run(nowSec(), row.id);
    }
  }
}

