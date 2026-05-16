import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PUBLIC_RETURN_PATH_KEY,
  consumeReturnPath,
  stashReturnPath,
} from './public-return';

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  sessionStorage.clear();
});

describe('public-return helpers', () => {
  it('stashReturnPath round-trips through consumeReturnPath', () => {
    stashReturnPath('/p/abc');
    expect(consumeReturnPath()).toBe('/p/abc');
    // consume() removes the key — a second call returns null.
    expect(consumeReturnPath()).toBeNull();
  });

  it('consumeReturnPath returns null when the key is absent', () => {
    expect(consumeReturnPath()).toBeNull();
  });

  // The startsWith('/p/') gate is a security-adjacent check: it prevents a
  // corrupted sessionStorage value (e.g. from an extension, or a stale
  // value written by an older build) from triggering an open redirect to
  // an external origin via the App.tsx post-login handler.
  it('rejects values that do not start with /p/', () => {
    sessionStorage.setItem(PUBLIC_RETURN_PATH_KEY, 'https://evil.com/');
    expect(consumeReturnPath()).toBeNull();
  });
  it('rejects empty values', () => {
    sessionStorage.setItem(PUBLIC_RETURN_PATH_KEY, '');
    expect(consumeReturnPath()).toBeNull();
  });
  it('rejects relative paths outside /p/', () => {
    sessionStorage.setItem(PUBLIC_RETURN_PATH_KEY, '/admin');
    expect(consumeReturnPath()).toBeNull();
  });

  it('clears the key even when stash/consume happens twice in a row', () => {
    stashReturnPath('/p/first');
    stashReturnPath('/p/second'); // overwrites
    expect(consumeReturnPath()).toBe('/p/second');
    expect(consumeReturnPath()).toBeNull();
  });
});
