import { randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import { stmts } from '../db.js';
import { sendMagicLink } from '../mailer.js';
import { authRequestLimiter } from './rate-limit.js';

const MAGIC_LINK_TTL_SECONDS = 15 * 60;

export async function handleAuthRequest(c: Context): Promise<Response> {
  const body = (await c.req.json<{ email?: unknown }>().catch(() => null)) as
    | { email?: unknown }
    | null;
  const rawEmail = body?.email;
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';

  if (!email) return c.json({ ok: true });

  if (!authRequestLimiter.tryConsume(email)) {
    return c.json({ ok: true });
  }

  const user = stmts.findUserByEmail.get(email);
  if (!user) return c.json({ ok: true });

  const token = randomBytes(32).toString('base64url');
  const expiresAt = Math.floor(Date.now() / 1000) + MAGIC_LINK_TTL_SECONDS;
  stmts.insertMagicLink.run(token, email, expiresAt);

  const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
  const link = `${appUrl}/auth/callback?token=${token}`;

  try {
    await sendMagicLink(email, link);
  } catch (err) {
    console.error('[auth/request] sendMagicLink failed', err);
  }

  return c.json({ ok: true });
}
