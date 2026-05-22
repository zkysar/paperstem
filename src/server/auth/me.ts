import type { Context } from 'hono';
import type { AuthVariables } from './middleware.js';
import { isDevLoginEnabled } from './dev-login.js';

export function handleMe(c: Context<{ Variables: AuthVariables }>): Response {
  const user = c.get('user');
  if (!user) {
    // "Who am I" with no session is a valid answer, not an error: return
    // 200 with a null user so anonymous loads (e.g. a public /p/<token>
    // share opened logged-out) don't surface a red 401 in the browser
    // console. devLoginUrl rides along so the dev auto-login flow still
    // works.
    const body: { user: null; devLoginUrl?: string } = { user: null };
    if (isDevLoginEnabled()) body.devLoginUrl = '/api/auth/dev-login';
    return c.json(body);
  }
  return c.json({ user });
}
