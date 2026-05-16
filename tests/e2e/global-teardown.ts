import { existsSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { STATE_FILE } from './helpers/server-info.js';

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(STATE_FILE)) return;
  const raw = readFileSync(STATE_FILE, 'utf8');
  const info = JSON.parse(raw) as { pid?: number; tmp?: string };
  if (info.pid != null) {
    try {
      // Negative pid → kill the process group, which sweeps the
      // `tsx watch` server and the `vite` child the launcher spawned.
      process.kill(-info.pid, 'SIGTERM');
    } catch {
      // Process already gone — fine.
    }
    await new Promise((r) => setTimeout(r, 500));
    try {
      process.kill(-info.pid, 'SIGKILL');
    } catch {
      // Already dead.
    }
  }
  if (info.tmp) {
    rmSync(info.tmp, { recursive: true, force: true });
  }
  try {
    unlinkSync(STATE_FILE);
  } catch {
    // Already removed.
  }
}
