import type { Context } from 'hono';
import { stmts } from './db.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';
import { addToAllowlist, isGatekeeper } from './allowlist.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireGatekeeper(
  c: Context<{ Variables: AuthVariables }>,
): Response | null {
  const user = requireUser(c);
  if (!isGatekeeper(user)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  return null;
}

export async function handleListAllowlist(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const denied = requireGatekeeper(c);
  if (denied) return denied;

  const rows = stmts.listAllowlistEntries.all();
  return c.json({
    entries: rows.map((r) => ({
      email: r.email,
      added_by_email: r.added_by_email,
      added_at: r.added_at,
      note: r.note,
    })),
  });
}

export async function handleAddAllowlist(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  if (!isGatekeeper(user)) return c.json({ error: 'forbidden' }, 403);

  let body: { email?: unknown; note?: unknown };
  try {
    body = (await c.req.json()) as { email?: unknown; note?: unknown };
  } catch {
    return c.json({ error: 'bad_json' }, 400);
  }

  const emailRaw =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!emailRaw) return c.json({ error: 'email_required' }, 400);
  if (!EMAIL_RE.test(emailRaw)) return c.json({ error: 'bad_email' }, 400);

  const note =
    typeof body.note === 'string' && body.note.trim().length > 0
      ? body.note.trim()
      : null;

  addToAllowlist(emailRaw, user.id, note);
  const entry = stmts.findAllowlistEntryJoined.get(emailRaw);
  return c.json(
    {
      entry: entry
        ? {
            email: entry.email,
            added_by_email: entry.added_by_email,
            added_at: entry.added_at,
            note: entry.note,
          }
        : null,
    },
    201,
  );
}

export async function handleRemoveAllowlist(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const denied = requireGatekeeper(c);
  if (denied) return denied;

  const emailRaw = (c.req.param('email') ?? '').trim().toLowerCase();
  if (!emailRaw) return c.json({ error: 'email_required' }, 400);

  const existing = stmts.findAllowlistEntry.get(emailRaw);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  stmts.deleteAllowlistEntry.run(emailRaw);
  return c.json({ ok: true });
}
