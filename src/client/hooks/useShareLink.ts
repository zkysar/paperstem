import { useCallback, useRef } from 'react';
import { decodeShareUrl, type ShareState } from '../lib/share-url';

export const PENDING_SHARE_HASH_KEY = 'paperstem.pendingShareHash';

export type UseShareLink = {
  /** Parsed once on first render. Subsequent renders return the same object. */
  initial: ShareState | null;
  /** Updates the address bar to `#p=<id>` (or clears it if null). */
  syncPracticeId: (id: string | null) => void;
};

function readInitialHash(): ShareState | null {
  if (typeof window === 'undefined') return null;
  const live = window.location.hash;
  if (live && live !== '#') {
    const parsed = decodeShareUrl(live);
    if (parsed) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return parsed;
    }
  }
  try {
    const stashed = sessionStorage.getItem(PENDING_SHARE_HASH_KEY);
    if (stashed) {
      sessionStorage.removeItem(PENDING_SHARE_HASH_KEY);
      const parsed = decodeShareUrl(stashed);
      if (parsed) return parsed;
    }
  } catch {
    // sessionStorage may be unavailable; treat as no pending state.
  }
  return null;
}

export function useShareLink(): UseShareLink {
  const initialRef = useRef<ShareState | null | undefined>(undefined);
  if (initialRef.current === undefined) {
    initialRef.current = readInitialHash();
  }

  const syncPracticeId = useCallback((id: string | null) => {
    if (typeof window === 'undefined') return;
    const next = id ? `#p=${encodeURIComponent(id)}` : '';
    if (window.location.hash === next) return;
    if (next) history.replaceState(null, '', next);
    else history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  return { initial: initialRef.current, syncPracticeId };
}
