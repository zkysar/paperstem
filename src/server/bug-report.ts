import type { Context } from 'hono';
import { requireUser, type AuthVariables } from './auth/middleware.js';
import { TokenBucketLimiter } from './auth/rate-limit.js';
import {
  sendBugReport,
  type BugReportClientError,
  type BugReportPayload,
} from './mailer.js';
import { githubUrlForVersion } from '../shared/version.js';

const MAX_DESCRIPTION = 5000;
const MAX_URL = 2048;
const MAX_UA = 1024;
const MAX_ERRORS = 20;
const MAX_PAGE_CONTEXT_BYTES = 16384;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

// 5 reports per hour per user, sliding-ish via TokenBucketLimiter
// (capacity 5, refill 1 token every 12 minutes -> ~5/hour).
export const bugReportLimiter = new TokenBucketLimiter(5, 12 * 60 * 1000);

type Body = {
  description?: unknown;
  url?: unknown;
  viewport?: unknown;
  userAgent?: unknown;
  pageContext?: unknown;
  recentErrors?: unknown;
  appVersion?: unknown;
  screenshotBase64?: unknown;
};

function asString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  if (v.length > max) return null;
  return v;
}

function parseViewport(v: unknown): { w: number; h: number } | null {
  if (!v || typeof v !== 'object') return null;
  const w = (v as { w?: unknown }).w;
  const h = (v as { h?: unknown }).h;
  if (typeof w !== 'number' || typeof h !== 'number') return null;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w < 0 || h < 0 || w > 16384 || h > 16384) return null;
  return { w: Math.round(w), h: Math.round(h) };
}

function parseErrors(v: unknown): BugReportClientError[] | null {
  if (!Array.isArray(v)) return null;
  if (v.length > MAX_ERRORS) return null;
  const out: BugReportClientError[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') return null;
    const ts = (item as { ts?: unknown }).ts;
    const message = (item as { message?: unknown }).message;
    const stack = (item as { stack?: unknown }).stack;
    if (typeof ts !== 'string' || ts.length > 64) return null;
    if (typeof message !== 'string' || message.length > 4096) return null;
    const entry: BugReportClientError = { ts, message };
    if (stack !== undefined) {
      if (typeof stack !== 'string' || stack.length > 8192) return null;
      entry.stack = stack;
    }
    out.push(entry);
  }
  return out;
}

function parsePageContext(v: unknown): Record<string, unknown> | null {
  if (v === null || v === undefined) return {};
  if (typeof v !== 'object' || Array.isArray(v)) return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(v);
  } catch {
    return null;
  }
  if (serialized.length > MAX_PAGE_CONTEXT_BYTES) return null;
  return v as Record<string, unknown>;
}

function decodeScreenshot(v: unknown): Buffer | null | 'invalid' {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return 'invalid';
  if (v.length === 0) return null;
  // base64 expands ~33%; cap encoded length to keep server-side memory bounded.
  if (v.length > Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3) + 8) return 'invalid';
  let buf: Buffer;
  try {
    buf = Buffer.from(v, 'base64');
  } catch {
    return 'invalid';
  }
  if (buf.length === 0 || buf.length > MAX_SCREENSHOT_BYTES) return 'invalid';
  // Minimal PNG signature sniff so we don't end up emailing arbitrary blobs.
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) return 'invalid';
  }
  return buf;
}

export async function handleBugReport(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);

  if (!bugReportLimiter.tryConsume(user.id)) {
    return c.json({ error: 'rate_limited' }, 429);
  }

  let body: Body;
  try {
    body = (await c.req.json()) as Body;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const description = asString(body.description, MAX_DESCRIPTION);
  if (!description || description.trim().length === 0) {
    return c.json({ error: 'invalid_description' }, 400);
  }
  const url = asString(body.url, MAX_URL) ?? '';
  const userAgent = asString(body.userAgent, MAX_UA) ?? '';
  const appVersion = asString(body.appVersion, 128) ?? 'unknown';

  const viewport = parseViewport(body.viewport) ?? { w: 0, h: 0 };
  const recentErrors = parseErrors(body.recentErrors);
  if (recentErrors === null) return c.json({ error: 'invalid_errors' }, 400);
  const pageContext = parsePageContext(body.pageContext);
  if (pageContext === null) return c.json({ error: 'invalid_context' }, 400);

  const decoded = decodeScreenshot(body.screenshotBase64);
  if (decoded === 'invalid') return c.json({ error: 'invalid_screenshot' }, 400);

  const payload: BugReportPayload = {
    reporterEmail: user.email,
    reporterUserId: user.id,
    description,
    url,
    viewport,
    userAgent,
    pageContext,
    recentErrors,
    appVersion,
    appVersionUrl: githubUrlForVersion(appVersion),
    screenshotPng: decoded ?? undefined,
  };

  try {
    await sendBugReport(payload);
  } catch (err) {
    console.error('bug report email failed', err);
    return c.json({ error: 'send_failed' }, 500);
  }

  return c.json({ ok: true });
}
