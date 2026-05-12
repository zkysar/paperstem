import type { Context } from 'hono';
import type { AuthVariables } from './middleware.js';
import { isDevLoginEnabled } from './dev-login.js';

export function handleMe(c: Context<{ Variables: AuthVariables }>): Response {
  const user = c.get('user');
  if (!user) {
    const body: { error: string; devLoginUrl?: string } = {
      error: 'unauthenticated',
    };
    if (isDevLoginEnabled()) body.devLoginUrl = '/api/auth/dev-login';
    return c.json(body, 401);
  }
  return c.json({ user });
}
