import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearClientErrorBuffer,
  getRecentClientErrors,
  installClientErrorBuffer,
  recordClientError,
} from './clientErrorBuffer';

describe('clientErrorBuffer', () => {
  beforeEach(() => clearClientErrorBuffer());
  afterEach(() => clearClientErrorBuffer());

  it('records and returns errors in insertion order', () => {
    recordClientError(new Error('one'));
    recordClientError(new Error('two'));
    const entries = getRecentClientErrors();
    expect(entries.map((e) => e.message)).toEqual(['one', 'two']);
    expect(entries[0]?.stack).toBeTruthy();
  });

  it('keeps only the last 10 entries', () => {
    for (let i = 0; i < 15; i++) recordClientError(new Error(`e${i}`));
    const entries = getRecentClientErrors();
    expect(entries).toHaveLength(10);
    expect(entries[0]?.message).toBe('e5');
    expect(entries[9]?.message).toBe('e14');
  });

  it('handles non-Error values', () => {
    recordClientError('string fail');
    recordClientError({ code: 500 });
    const entries = getRecentClientErrors();
    expect(entries[0]?.message).toBe('string fail');
    expect(entries[0]?.stack).toBeUndefined();
    expect(entries[1]?.message).toContain('500');
  });

  it('captures window error events when installed', () => {
    installClientErrorBuffer(window);
    const err = new Error('boom');
    const event = new ErrorEvent('error', { error: err, message: 'boom' });
    window.dispatchEvent(event);
    const entries = getRecentClientErrors();
    expect(entries.at(-1)?.message).toBe('boom');
  });

  it('captures unhandledrejection events when installed', () => {
    installClientErrorBuffer(window);
    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: new Error('rejected') });
    window.dispatchEvent(event);
    const entries = getRecentClientErrors();
    expect(entries.at(-1)?.message).toBe('rejected');
  });

  it('is idempotent on repeated install calls', () => {
    installClientErrorBuffer(window);
    installClientErrorBuffer(window);
    const event = new ErrorEvent('error', { error: new Error('once'), message: 'once' });
    window.dispatchEvent(event);
    const entries = getRecentClientErrors();
    expect(entries.filter((e) => e.message === 'once')).toHaveLength(1);
  });
});
