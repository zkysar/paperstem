import type { Context } from 'hono';
import { randomBytes } from 'node:crypto';
import { stmts } from './db.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';
import { SESSION_COOKIE_NAME } from './auth/cookie.js';

const TEN_YEARS_SEC = 10 * 365 * 24 * 60 * 60;

function newTokenValue(): string {
  return randomBytes(32).toString('base64url');
}

function newPublicId(): string {
  return `tk_${randomBytes(12).toString('base64url')}`;
}

export async function handleListTokens(
  c: Context<{ Variables: AuthVariables }>,
) {
  const user = requireUser(c);
  const rows = stmts.listUserTokens.all(user.id);
  return c.json({ tokens: rows });
}

export async function handleCreateToken(
  c: Context<{ Variables: AuthVariables }>,
) {
  const user = requireUser(c);
  let body: { label?: unknown };
  try {
    body = (await c.req.json()) as { label?: unknown };
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label || label.length > 200) {
    return c.json({ error: 'label_required' }, 400);
  }
  const cookieValue = newTokenValue();
  const publicId = newPublicId();
  const nowSec = Math.floor(Date.now() / 1000);
  stmts.createToken.run(
    cookieValue,
    user.id,
    label,
    publicId,
    nowSec + TEN_YEARS_SEC,
    nowSec,
  );
  return c.json(
    {
      token: {
        id: publicId,
        label,
        created_at: nowSec,
        expires_at: nowSec + TEN_YEARS_SEC,
        last_used_at: null,
      },
      cookie_name: SESSION_COOKIE_NAME,
      cookie_value: cookieValue,
    },
    201,
  );
}

export async function handleRevokeToken(
  c: Context<{ Variables: AuthVariables }>,
) {
  const user = requireUser(c);
  const id = c.req.param('id');
  const result = stmts.revokeToken.run(id, user.id);
  if (result.changes === 0) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.body(null, 204);
}
