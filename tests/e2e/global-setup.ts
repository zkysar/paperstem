import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATE_FILE } from './helpers/server-info.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

// Spawn `npx tsx bin/dev.ts` with a fresh DB + audio root, parse the printed
// UI URL, wait for /api/me to respond, then stash the URL + pid in a JSON
// file that the test fixtures and globalTeardown read. We use bin/dev.ts
// directly (not scripts/dev.sh) because the latter routes through
// with-secrets.sh, which uses macOS Keychain.
export default async function globalSetup(): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), 'paperstem-e2e-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GMAIL_USER: process.env.GMAIL_USER || 'e2e@example.com',
    GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD || 'placeholder',
    SESSION_COOKIE_SECRET:
      process.env.SESSION_COOKIE_SECRET || 'e2e-test-secret-not-prod',
    DATABASE_PATH: join(tmp, 'test.sqlite'),
    PAPERSTEM_AUDIO_ROOT: join(tmp, 'audio'),
    PAPERSTEM_DEV_AUTO_LOGIN: 'e2e@paperstem.local',
    // The snapshot/backup scheduler is wall-clock driven and irrelevant to
    // UI journeys. Disable it so it doesn't spam logs or fire timers.
    PAPERSTEM_DISABLE_SCHEDULER: '1',
    // Quiet hono's request logger — keeps the test output focused.
    PAPERSTEM_REQUEST_LOG: '0',
  };

  // detached:true puts the child in its own process group so we can later
  // SIGTERM the group and reap any grandchildren (vite, tsx watch). The
  // group id is the child's pid; we save it so teardown can kill -PID.
  const child = spawn('npx', ['tsx', 'bin/dev.ts'], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  const url = await new Promise<string>((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('[e2e] timed out (60s) waiting for dev launcher UI URL'));
    }, 60_000);
    child.stdout!.on('data', (chunk: Buffer) => {
      const s = chunk.toString();
      buf += s;
      process.stdout.write(s);
      const m = /UI:\s+(https?:\/\/[^\s]+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `[e2e] dev launcher exited (code=${code}, signal=${signal}) before printing UI URL`,
        ),
      );
    });
  });

  // Detach so this Node parent doesn't block on the child during teardown.
  child.unref();

  // The UI URL is up but Vite may still be optimizing deps and the API
  // may not have completed dev-seed. Poll /api/me until it responds (200
  // with a session, or 401 with devLoginUrl — either is fine).
  await waitForReady(url, 60_000);

  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ baseURL: url, pid: child.pid, tmp }, null, 2),
  );
  console.log(`[e2e] dev server ready at ${url} (pid=${child.pid})`);
}

async function waitForReady(baseURL: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseURL}/api/me`, {
        // Vite may serve index.html for an unproxied / before plugins finish
        // configuring — we explicitly want JSON.
        headers: { accept: 'application/json' },
      });
      // 200 (logged in) or 401 with devLoginUrl (auth gate ready) both mean
      // the API is up and routing through Vite's proxy correctly.
      if (res.status === 200 || res.status === 401) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `[e2e] /api/me did not become ready within ${timeoutMs}ms (lastErr=${lastErr})`,
  );
}
