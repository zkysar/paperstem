import { randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import { stmts } from '../db.js';
import { getSessionId, setSessionCookie } from './cookie.js';

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export async function handleAuthVerify(c: Context): Promise<Response> {
  const existing = getSessionId(c);
  if (existing) {
    const row = stmts.findSessionWithUser.get(existing);
    const nowSec = Math.floor(Date.now() / 1000);
    if (row && row.session_expires_at > nowSec) {
      return c.json({ error: 'already_authenticated' }, 409);
    }
  }

  const body = (await c.req.json<{ token?: unknown }>().catch(() => null)) as
    | { token?: unknown }
    | null;
  const rawToken = body?.token;
  const token = typeof rawToken === 'string' ? rawToken : '';
  if (!token) return c.json({ error: 'invalid_or_expired' }, 401);

  const info = stmts.consumeMagicLink.run(token);
  if (info.changes !== 1) return c.json({ error: 'invalid_or_expired' }, 401);

  const link = stmts.findMagicLink.get(token);
  if (!link) return c.json({ error: 'invalid_or_expired' }, 401);

  const user = stmts.findUserByEmail.get(link.email);
  if (!user) return c.json({ error: 'invalid_or_expired' }, 401);

  const sessionId = randomBytes(32).toString('base64url');
  const nowSec = Math.floor(Date.now() / 1000);
  stmts.insertSession.run(
    sessionId,
    user.id,
    nowSec + SESSION_TTL_SECONDS,
    nowSec,
  );
  setSessionCookie(c, sessionId);

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
    },
  });
}
