import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useShareLink, PENDING_SHARE_HASH_KEY } from './useShareLink';

function setHash(h: string) {
  history.replaceState(null, '', h);
}

describe('useShareLink', () => {
  beforeEach(() => {
    setHash(window.location.pathname);
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  it('parses location.hash on mount and strips it', () => {
    setHash('#p=abc&t=10.50');
    const { result } = renderHook(() => useShareLink());
    expect(result.current.initial).toEqual({ projectId: 'abc', time: 10.5 });
    expect(window.location.hash).toBe('');
  });

  it('falls back to sessionStorage when hash is empty', () => {
    sessionStorage.setItem(PENDING_SHARE_HASH_KEY, '#p=def');
    const { result } = renderHook(() => useShareLink());
    expect(result.current.initial).toEqual({ projectId: 'def' });
    expect(sessionStorage.getItem(PENDING_SHARE_HASH_KEY)).toBeNull();
  });

  it('returns null initial when neither source has p', () => {
    const { result } = renderHook(() => useShareLink());
    expect(result.current.initial).toBeNull();
  });

  it('syncProjectId writes #p=<id>', () => {
    const { result } = renderHook(() => useShareLink());
    act(() => result.current.syncProjectId('xyz'));
    expect(window.location.hash).toBe('#p=xyz');
    act(() => result.current.syncProjectId(null));
    expect(window.location.hash).toBe('');
  });
});
