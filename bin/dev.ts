import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

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

const apiPort = await getFreePort();
const vitePort = await getFreePort();
if (apiPort === vitePort) throw new Error('dev.ts: collision picking free ports');

const env: NodeJS.ProcessEnv = {
  ...process.env,
  PORT: String(apiPort),
  PAPERSTEM_API_PORT: String(apiPort),
  PAPERSTEM_VITE_PORT: String(vitePort),
  APP_URL: `http://localhost:${vitePort}`,
};

const apiUrl = `http://localhost:${apiPort}`;
const uiUrl = `http://localhost:${vitePort}`;
process.stdout.write(
  `\n  paperstem dev\n` +
    `    UI:  ${uiUrl}\n` +
    `    API: ${apiUrl}\n\n`,
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
