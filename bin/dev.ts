import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const { port } = addr;
        srv.close((err) => (err ? reject(err) : resolve(port)));
      } else {
        srv.close();
        reject(new Error('dev.ts: failed to obtain free port'));
      }
    });
  });
}

// Respect a caller-provided Vite port (e.g. Claude Preview MCP allocates a
// port up front and expects the server to bind to it). PORT is the
// conventional env var the preview/launcher tooling sets; PAPERSTEM_VITE_PORT
// is the project-specific override. Fall back to a free OS-picked port
// otherwise so multiple worktrees still run side-by-side.
const envVitePort = Number(
  process.env.PAPERSTEM_VITE_PORT || process.env.PORT || 0,
);
const envApiPort = Number(process.env.PAPERSTEM_API_PORT || 0);
const apiPort = Number.isFinite(envApiPort) && envApiPort > 0 ? envApiPort : await getFreePort();
const vitePort = Number.isFinite(envVitePort) && envVitePort > 0 ? envVitePort : await getFreePort();
if (apiPort === vitePort) throw new Error('dev.ts: collision picking free ports');

const audioRoot =
  process.env.PAPERSTEM_AUDIO_ROOT?.trim() ||
  resolve(process.cwd(), 'audio-dev');
mkdirSync(audioRoot, { recursive: true });

const devLoginEmail =
  process.env.PAPERSTEM_DEV_AUTO_LOGIN === undefined
    ? 'dev@paperstem.local'
    : process.env.PAPERSTEM_DEV_AUTO_LOGIN.trim();

const env: NodeJS.ProcessEnv = {
  ...process.env,
  PORT: String(apiPort),
  PAPERSTEM_API_PORT: String(apiPort),
  PAPERSTEM_VITE_PORT: String(vitePort),
  APP_URL: `http://localhost:${vitePort}`,
  PAPERSTEM_AUDIO_ROOT: audioRoot,
  PAPERSTEM_DEV_AUTO_LOGIN: devLoginEmail,
};

const apiUrl = `http://localhost:${apiPort}`;
const uiUrl = `http://localhost:${vitePort}`;
const devLoginLine = devLoginEmail
  ? `    Dev login (${devLoginEmail}): ${uiUrl}/api/auth/dev-login\n`
  : '';
process.stdout.write(
  `\n  paperstem dev\n` +
    `    UI:  ${uiUrl}\n` +
    `    API: ${apiUrl}\n` +
    `    Audio: ${audioRoot}\n` +
    devLoginLine +
    `\n`,
);

const children = [
  spawn('npx', ['tsx', 'watch', 'src/server/index.ts'], {
    env,
    stdio: 'inherit',
  }),
  spawn('npx', ['vite'], { env, stdio: 'inherit' }),
];

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals | null, exitCode: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (!c.killed && c.pid != null) c.kill(signal ?? 'SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 1000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT', 130));
process.on('SIGTERM', () => shutdown('SIGTERM', 143));
for (const c of children) {
  c.on('exit', (code, signal) => shutdown(signal, code ?? (signal ? 1 : 0)));
}
