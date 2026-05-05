import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { stmts } from '../db.js';
import type { User } from '../../shared/types.js';
import { getSessionId } from './cookie.js';

export type AuthVariables = {
  user: User | null;
  sessionId: string | null;
};

export const sessionMiddleware: MiddlewareHandler<{ Variables: AuthVariables }> =
  async (c, next) => {
    const sessionId = getSessionId(c) ?? null;
    if (!sessionId) {
      c.set('user', null);
      c.set('sessionId', null);
      return next();
    }
    const row = stmts.findSessionWithUser.get(sessionId);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!row || row.session_expires_at <= nowSec) {
      c.set('user', null);
      c.set('sessionId', null);
      return next();
    }
    c.set('user', {
      id: row.id,
      email: row.email,
      display_name: row.display_name,
    });
    c.set('sessionId', sessionId);
    return next();
  };

export function requireUser(c: Context<{ Variables: AuthVariables }>): User {
  const user = c.get('user');
  if (!user) {
    throw new HTTPException(401, { message: 'unauthenticated' });
  }
  return user;
}
