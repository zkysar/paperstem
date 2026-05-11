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

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
