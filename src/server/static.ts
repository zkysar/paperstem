import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
import type { AuthVariables } from './auth/middleware.js';

export function registerStatic(app: Hono<{ Variables: AuthVariables }>): void {
  app.use(
    '/*',
    serveStatic({
      root: './dist/client',
    }),
  );
  app.get('*', serveStatic({ path: './dist/client/index.html' }));
}
