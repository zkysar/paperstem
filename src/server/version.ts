import type { Context } from 'hono';

export function handleVersion(c: Context): Response {
  return c.json({
    version: process.env.APP_VERSION ?? 'dev',
    env: process.env.APP_ENV ?? 'local',
  });
}
