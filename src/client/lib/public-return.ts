// Tiny module holding the sessionStorage key + read/write helpers that
// anonymous viewers of /p/<token> use to bounce through the magic-link
// sign-in flow and come back. Lives outside PublicProjectView so App.tsx
// can import it without pulling the whole public view tree into the
// authenticated bundle (which would defeat the lazy() split in main.tsx).

export const PUBLIC_RETURN_PATH_KEY = 'paperstem.public-return-path';

// Stash the current pathname before bouncing an anonymous viewer to /
// for the magic-link round trip. Best-effort: sessionStorage can throw
// in private-mode browsers — we'd rather drop the redirect than crash.
export function stashReturnPath(path: string): void {
  try {
    sessionStorage.setItem(PUBLIC_RETURN_PATH_KEY, path);
  } catch {
    /* ignore */
  }
}

// Read + remove the stashed return path. Returns null if there's no
// pending bounce or the value isn't under /p/ (defensive — sessionStorage
// values can't be tampered with cross-origin, but the startsWith gate
// keeps a corrupted value from triggering an open redirect).
export function consumeReturnPath(): string | null {
  let pending: string | null = null;
  try {
    pending = sessionStorage.getItem(PUBLIC_RETURN_PATH_KEY);
  } catch {
    return null;
  }
  if (!pending || !pending.startsWith('/p/')) return null;
  try {
    sessionStorage.removeItem(PUBLIC_RETURN_PATH_KEY);
  } catch {
    /* ignore */
  }
  return pending;
}
