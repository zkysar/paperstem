import { randomBytes, randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { stmts } from '../db.js';
import { setSessionCookie } from './cookie.js';

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export function isDevLoginEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    typeof process.env.PAPERSTEM_DEV_AUTO_LOGIN === 'string' &&
    process.env.PAPERSTEM_DEV_AUTO_LOGIN.trim() !== ''
  );
}

export function handleDevLogin(c: Context): Response {
  if (!isDevLoginEnabled()) {
    return c.json({ error: 'not_found' }, 404);
  }

  const emailOverride = c.req.query('email')?.trim().toLowerCase() ?? '';
  const email = emailOverride || process.env.PAPERSTEM_DEV_AUTO_LOGIN!.trim().toLowerCase();
  const nowSec = Math.floor(Date.now() / 1000);

  let user = stmts.findUserByEmail.get(email);
  if (!user) {
    const id = randomUUID();
    stmts.insertUser.run(id, email, null, nowSec);
    user = stmts.findUserByEmail.get(email);
    if (!user) return c.json({ error: 'user_create_failed' }, 500);
  }

  const sessionId = randomBytes(32).toString('base64url');
  stmts.insertSession.run(
    sessionId,
    user.id,
    nowSec + SESSION_TTL_SECONDS,
    nowSec,
  );
  setSessionCookie(c, sessionId);

  return c.redirect('/', 302);
}
