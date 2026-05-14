import { serve } from '@hono/node-server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { handleAuthRequest } from './auth/request.js';
import { handleAuthVerify } from './auth/verify.js';
import { handleAuthLogout } from './auth/logout.js';
import { handleDevLogin, isDevLoginEnabled } from './auth/dev-login.js';
import { seedDevBandIfNeeded } from './auth/dev-seed.js';
import { handleMe } from './auth/me.js';
import {
  handleListTokens,
  handleCreateToken,
  handleRevokeToken,
} from './tokens.js';
import { sessionMiddleware, type AuthVariables } from './auth/middleware.js';
import { handleListBands, handleGetBand } from './bands.js';
import {
  handleCreateProject,
  handleCreateStem,
  handleDeleteProject,
  handleGetProject,
  handleListProjects,
  handleRenameProject,
  handleRestoreProject,
  handleUpdateStemPeaks,
} from './projects.js';
import {
  handleDeleteStem,
  handleRenameStem,
  handleRestoreStem,
} from './stems.js';
import { handleListTrash } from './trash.js';
import { handleGetAudio } from './audio.js';
import {
  handleCreateAnnotation,
  handleDeleteAnnotation,
  handleListAnnotations,
  handlePatchAnnotation,
} from './annotations.js';
import {
  handleCreateReply,
  handleDeleteReply,
  handleListReplies,
  handlePatchReply,
} from './annotation-replies.js';
import {
  handleAddAnnotationReaction,
  handleAddReplyReaction,
  handleRemoveAnnotationReaction,
  handleRemoveReplyReaction,
} from './annotation-reactions.js';
import { handleSnapshotsHealth } from './health.js';
import { handleVersion } from './version.js';
import { handleBugReport } from './bug-report.js';
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
if (isDevLoginEnabled()) {
  app.get('/api/auth/dev-login', handleDevLogin);
}
app.get('/api/me', handleMe);
app.get('/api/me/tokens', handleListTokens);
app.post('/api/me/tokens', handleCreateToken);
app.delete('/api/me/tokens/:id', handleRevokeToken);
app.get('/api/bands', handleListBands);
app.get('/api/bands/:id', handleGetBand);
app.get('/api/projects', handleListProjects);
app.get('/api/projects/:id', handleGetProject);
app.post('/api/projects', handleCreateProject);
app.patch('/api/projects/:id', handleRenameProject);
app.delete('/api/projects/:id', handleDeleteProject);
app.post('/api/projects/:id/restore', handleRestoreProject);
app.post('/api/projects/:id/stems', handleCreateStem);
app.patch('/api/stems/:id', handleRenameStem);
app.delete('/api/stems/:id', handleDeleteStem);
app.post('/api/stems/:id/restore', handleRestoreStem);
app.put('/api/stems/:id/peaks', handleUpdateStemPeaks);
app.get('/api/bands/:id/trash', handleListTrash);
app.get('/api/audio/:stem_id', handleGetAudio);
app.get('/api/projects/:id/annotations', handleListAnnotations);
app.post('/api/projects/:id/annotations', handleCreateAnnotation);
app.patch('/api/annotations/:id', handlePatchAnnotation);
app.delete('/api/annotations/:id', handleDeleteAnnotation);
app.get('/api/annotations/:annotationId/replies', handleListReplies);
app.post('/api/annotations/:annotationId/replies', handleCreateReply);
app.patch('/api/annotation-replies/:id', handlePatchReply);
app.delete('/api/annotation-replies/:id', handleDeleteReply);
app.post('/api/annotations/:annotationId/reactions', handleAddAnnotationReaction);
app.delete('/api/annotations/:annotationId/reactions', handleRemoveAnnotationReaction);
app.post('/api/annotation-replies/:replyId/reactions', handleAddReplyReaction);
app.delete('/api/annotation-replies/:replyId/reactions', handleRemoveReplyReaction);
app.get('/api/health/snapshots', handleSnapshotsHealth);
app.get('/api/version', handleVersion);
app.post('/api/bug-report', handleBugReport);

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

if (isDevLoginEnabled()) {
  await seedDevBandIfNeeded().catch((err) => {
    console.error('[dev-seed] failed:', err);
  });
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`paperstem server listening on http://localhost:${info.port}`);
});

if (!process.env.PAPERSTEM_DISABLE_SCHEDULER) {
  startScheduler();
}
