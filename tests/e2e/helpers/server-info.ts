import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Shared between global-setup, global-teardown, and fixtures. Kept under
// node_modules/.tmp so it's already gitignored and never accidentally
// committed.
export const STATE_FILE = join(
  __dirname,
  '..',
  '..',
  '..',
  'node_modules',
  '.tmp',
  'paperstem-e2e-server.json',
);

export function readServerInfo(): { baseURL: string; pid: number; tmp: string } {
  const raw = readFileSync(STATE_FILE, 'utf8');
  return JSON.parse(raw) as { baseURL: string; pid: number; tmp: string };
}
