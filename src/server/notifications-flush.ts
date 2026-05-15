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

function bucketByRecipient(rows: PendingNotificationRow[]): Map<string, PendingNotificationRow[]> {
  const map = new Map<string, PendingNotificationRow[]>();
  for (const r of rows) {
    const list = map.get(r.recipient_id) ?? [];
    list.push(r);
    map.set(r.recipient_id, list);
  }
  return map;
}

function groupByProject(rows: PendingNotificationRow[]): Map<string, PendingNotificationRow[]> {
  const m = new Map<string, PendingNotificationRow[]>();
  for (const r of rows) {
    const list = m.get(r.project_id) ?? [];
    list.push(r);
    m.set(r.project_id, list);
  }
  return m;
}

function hourMatchesUserLocal(prefs: { digest_hour_local: number; timezone: string }, now: Date): boolean {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: prefs.timezone });
    const parts = fmt.formatToParts(now);
    const h = parts.find((p) => p.type === 'hour')?.value;
    return h !== undefined && Number(h) === prefs.digest_hour_local;
  } catch {
    return false;
  }
}

export async function flushPendingNotifications(opts: FlushOptions): Promise<void> {
  const allRows = stmts.selectAllUnsent.all() as PendingNotificationRow[];
  if (allRows.length === 0) return;
  const buckets = bucketByRecipient(allRows);
  const now = new Date();
  for (const [recipientId, rows] of buckets) {
    const prefs = getEffectivePrefs(recipientId);
    const isDailyUser =
      prefs.email_project_activity === 'daily' || prefs.email_thread_activity === 'daily';
    if (opts.mode === 'batched' && isDailyUser) continue;
    if (opts.mode === 'daily' && !isDailyUser) continue;
    if (opts.mode === 'daily' && !hourMatchesUserLocal(prefs, now)) continue;

    const to = fetchUserEmail(recipientId);
    if (!to) {
      for (const r of rows) stmts.markPendingSent.run(nowSec(), r.id);
      continue;
    }
    const byProject = groupByProject(rows);
    const groups: DigestProjectGroup[] = [];
    const linksByGroupEventIndex = new Map<string, string>();
    let groupIndex = 0;
    for (const [pid, projectRows] of byProject) {
      const projectName = fetchProjectName(pid);
      const events: DigestEvent[] = projectRows.map((r) => ({
        authorName: fetchUserName(r.author_user_id), preview: r.preview,
      }));
      groups.push({ projectName, events });
      projectRows.forEach((r, eventIndex) => {
        linksByGroupEventIndex.set(`${groupIndex}:${eventIndex}`, commentLink(opts, r));
      });
      groupIndex++;
    }
    const representativeToken = rows[rows.length - 1].reply_token ?? '';

    const linkBuilder = (_g: DigestProjectGroup, _ev: DigestEvent, idx: number): string => {
      const gi = groups.indexOf(_g);
      return linksByGroupEventIndex.get(`${gi}:${idx}`) ?? '';
    };

    try {
      await sendDigestEmail({
        to, daily: opts.mode === 'daily', groups,
        linkBuilder,
        settingsLink: settingsLink(opts),
        representativeReplyToken: representativeToken,
        inboundDomain: opts.inboundDomain,
      });
      for (const r of rows) stmts.markPendingSent.run(nowSec(), r.id);
    } catch {
      for (const r of rows) {
        stmts.bumpPendingAttempt.run(r.id);
        const after = stmts.findPendingById.get(r.id) as PendingNotificationRow | undefined;
        if (after && after.send_attempts >= MAX_ATTEMPTS) {
          stmts.markPendingSent.run(nowSec(), r.id);
        }
      }
    }
  }
}
