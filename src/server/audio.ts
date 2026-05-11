import type { Context } from 'hono';
import { stmts } from './db.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';
import { DriveNotFoundError, getDriveFile } from './drive.js';

const FORWARD_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
];

export async function handleGetAudio(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  const stemId = c.req.param('stem_id') ?? '';
  if (!stemId) return c.json({ error: 'not_found' }, 404);

  const stem = stmts.findStemWithBandId.get(stemId);
  if (!stem) return c.json({ error: 'not_found' }, 404);

  const membership = stmts.findMembership.get(stem.band_id, user.id);
  if (!membership) return c.json({ error: 'not_found' }, 404);

  const range = c.req.header('range');

  let upstream: Awaited<ReturnType<typeof getDriveFile>>;
  try {
    upstream = await getDriveFile(stem.drive_file_id, range);
  } catch (err) {
    if (err instanceof DriveNotFoundError) {
      stmts.markStemGhost.run(Math.floor(Date.now() / 1000), stemId);
      console.warn('[audio] drive 404, marked stem as drive_missing', { stemId });
      return c.json({ error: 'drive_missing' }, 410);
    }
    console.error('[audio] drive fetch failed', { stemId, err });
    return c.json({ error: 'upstream_error' }, 502);
  }

  const headers = new Headers();
  for (const name of FORWARD_HEADERS) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, v);
  }
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');

  return new Response(upstream.body, { status: upstream.status, headers });
}
