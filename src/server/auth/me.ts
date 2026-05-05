import type { Context } from 'hono';
import type { AuthVariables } from './middleware.js';

export function handleMe(c: Context<{ Variables: AuthVariables }>): Response {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  return c.json({ user });
}
