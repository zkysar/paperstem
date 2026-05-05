import type { Context } from 'hono';
import { stmts } from '../db.js';
import { clearSessionCookie, getSessionId } from './cookie.js';

export function handleAuthLogout(c: Context): Response {
  const sessionId = getSessionId(c);
  if (sessionId) {
    stmts.deleteSession.run(sessionId);
  }
  clearSessionCookie(c);
  return c.json({ ok: true });
}
