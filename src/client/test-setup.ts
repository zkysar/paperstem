// Node 25 ships a partial built-in `localStorage` that's missing the standard
// `setItem` / `getItem` / `clear` methods (it's gated behind a CLI flag).
// happy-dom's storage gets shadowed by it. Install a working in-memory
// replacement so tests can use the standard API.
class InMemoryStorage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.store.has(k) ? this.store.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
}

const stub = new InMemoryStorage();
Object.defineProperty(globalThis, 'localStorage', {
  value: stub,
  configurable: true,
  writable: true,
});
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: stub,
    configurable: true,
    writable: true,
  });
  if (window.confirm === undefined) {
    Object.defineProperty(window, 'confirm', {
      value: () => false,
      configurable: true,
      writable: true,
    });
  }
}

// happy-dom logs resource-fetch failures (e.g. anchor hrefs to drive.google.com)
// even though tests never click them. Filter that noise out across all sinks.
const noiseRe = /^GET https?:\/\/.* \d{3} /;
const wrap = (orig: (...args: unknown[]) => void) =>
  (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && noiseRe.test(first)) return;
    orig(...args);
  };
console.log = wrap(console.log.bind(console));
console.error = wrap(console.error.bind(console));
console.warn = wrap(console.warn.bind(console));
console.info = wrap(console.info.bind(console));
const origWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
  if (typeof chunk === 'string' && noiseRe.test(chunk)) return true;
  return (origWrite as unknown as (...a: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stderr.write;
const origStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
  if (typeof chunk === 'string' && noiseRe.test(chunk)) return true;
  return (origStdoutWrite as unknown as (...a: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stdout.write;

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
