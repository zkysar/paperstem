import { useCallback, useEffect, useState } from 'react';
import {
  buildPublicLinkUrl,
  createPublicLink,
  listProjectPublicLinks,
  revokePublicLink,
  type PublicLinkSummary,
} from '../data/public-links-admin';

type Props = { projectId: string };

// A clearly-delineated section inside ShareDialog for managing a project's
// public link. Public links are stored server-side, scoped to a single
// project, and bypass auth — making this UI deliberately blunt: explicit
// warning, one big button to create, one big button to revoke.
export function PublicLinkSection({ projectId }: Props) {
  const [links, setLinks] = useState<PublicLinkSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [busyToken, setBusyToken] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listProjectPublicLinks(projectId);
      setLinks(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCreate = useCallback(async () => {
    // Symmetric with revoke's confirm prompt. Creating a public link is the
    // more dangerous direction (revoke is recoverable; "this link has been
    // listened to by someone you didn't intend" isn't), so it deserves at
    // least as much friction as taking it down.
    if (
      !window.confirm(
        'Create a public link? Anyone with the URL can listen to this project without signing in.',
      )
    ) {
      return;
    }
    setBusyToken('__create__');
    setError(null);
    try {
      const link = await createPublicLink(projectId);
      setLinks((cur) => [link, ...(cur ?? [])]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyToken(null);
    }
  }, [projectId]);

  const onRevoke = useCallback(async (token: string) => {
    if (!window.confirm('Revoke this link? Anyone who has it will lose access.')) {
      return;
    }
    setBusyToken(token);
    setError(null);
    try {
      await revokePublicLink(token);
      setLinks((cur) =>
        (cur ?? []).map((l) =>
          l.token === token
            ? { ...l, revoked_at: Math.floor(Date.now() / 1000) }
            : l,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyToken(null);
    }
  }, []);

  const onCopy = useCallback(async (token: string) => {
    const url = buildPublicLinkUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      window.setTimeout(() => {
        setCopiedToken((cur) => (cur === token ? null : cur));
      }, 1500);
    } catch {
      setError("Couldn't copy automatically. Select the URL above and copy manually.");
    }
  }, []);

  const liveLinks = (links ?? []).filter((l) => l.revoked_at === null);
  const hasLive = liveLinks.length > 0;

  return (
    <section className="share-dialog-public-section" data-testid="public-link-section">
      <h3 className="share-dialog-section-title">Public link</h3>
      <p className="share-dialog-public-blurb">
        Anyone with this URL can listen to the project, play stems, and read
        comments — no sign-in required. They can't post, edit, or see other
        projects.
      </p>

      {loading && !links && <p className="share-dialog-empty">Loading…</p>}
      {error && (
        <p className="share-dialog-error" role="status">
          {error}
        </p>
      )}

      {hasLive ? (
        <ul className="share-dialog-public-list">
          {liveLinks.map((l) => {
            const url = buildPublicLinkUrl(l.token);
            const isBusy = busyToken === l.token;
            return (
              <li key={l.token} className="share-dialog-public-row">
                <input
                  type="text"
                  className="share-dialog-url"
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Public link URL"
                />
                <button
                  type="button"
                  className={
                    'share-dialog-copy' + (copiedToken === l.token ? ' copied' : '')
                  }
                  onClick={() => void onCopy(l.token)}
                >
                  {copiedToken === l.token ? 'Copied ✓' : 'Copy'}
                </button>
                <button
                  type="button"
                  className="share-dialog-revoke"
                  onClick={() => void onRevoke(l.token)}
                  disabled={isBusy}
                >
                  Revoke
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <button
          type="button"
          className="share-dialog-create-public"
          onClick={() => void onCreate()}
          disabled={busyToken === '__create__'}
        >
          {busyToken === '__create__' ? 'Creating…' : 'Create public link'}
        </button>
      )}
    </section>
  );
}
