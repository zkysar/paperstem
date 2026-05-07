import { serve } from '@hono/node-server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { handleAuthRequest } from './auth/request.js';
import { handleAuthVerify } from './auth/verify.js';
import { handleAuthLogout } from './auth/logout.js';
import { handleMe } from './auth/me.js';
import { sessionMiddleware, type AuthVariables } from './auth/middleware.js';
import { handleListBands, handleGetBand } from './bands.js';
import {
  handleCreatePractice,
  handleCreateStem,
  handleGetPractice,
  handleListPractices,
} from './practices.js';
import { handleGetAudio } from './audio.js';
import {
  handleCreateAnnotation,
  handleDeleteAnnotation,
  handleListAnnotations,
  handlePatchAnnotation,
} from './annotations.js';
import { handleSnapshotsHealth } from './health.js';
import { startScheduler } from './jobs/scheduler.js';
import { registerStatic } from './static.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const callbackHtmlTemplate = readFileSync(
  join(__dirname, 'auth/callback.html'),
  'utf8',
);

const app = new Hono<{ Variables: AuthVariables }>();

app.use('*', sessionMiddleware);

app.post('/api/auth/request', handleAuthRequest);
app.post('/api/auth/verify', handleAuthVerify);
app.post('/api/auth/logout', handleAuthLogout);
app.get('/api/me', handleMe);
app.get('/api/bands', handleListBands);
app.get('/api/bands/:id', handleGetBand);
app.get('/api/practices', handleListPractices);
app.get('/api/practices/:id', handleGetPractice);
app.post('/api/practices', handleCreatePractice);
app.post('/api/practices/:id/stems', handleCreateStem);
app.get('/api/audio/:stem_id', handleGetAudio);
app.get('/api/practices/:id/annotations', handleListAnnotations);
app.post('/api/practices/:id/annotations', handleCreateAnnotation);
app.patch('/api/annotations/:id', handlePatchAnnotation);
app.delete('/api/annotations/:id', handleDeleteAnnotation);
app.get('/api/health/snapshots', handleSnapshotsHealth);

app.get('/auth/callback', (c) => {
  const token = c.req.query('token') ?? '';
  const safeToken = token.replace(/[^A-Za-z0-9_-]/g, '');
  const html = callbackHtmlTemplate.replace('{{TOKEN}}', safeToken);
  return c.html(html);
});

if (process.env.NODE_ENV === 'production') {
  registerStatic(app);
}

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`paperstem server listening on http://localhost:${info.port}`);
});

if (!process.env.PAPERSTEM_DISABLE_SCHEDULER) {
  startScheduler();
}
