import { useEffect, useState } from 'react';
import { Copy, X } from 'lucide-react';

type TokenRow = {
  id: string;
  label: string;
  created_at: number;
  last_used_at: number | null;
};

type CreatedToken = {
  token: TokenRow;
  cookie_name: string;
  cookie_value: string;
};

type Props = {
  open: boolean;
  onClose(): void;
};

export function TokensDrawer({ open, onClose }: Props) {
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedToken | null>(null);

  useEffect(() => {
    if (!open) {
      setShowForm(false);
      setLabel('');
      setCreated(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open]);

  async function refresh() {
    setError(null);
    try {
      const res = await fetch('/api/me/tokens', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { tokens: TokenRow[] };
      setTokens(body.tokens);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/me/tokens', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as CreatedToken;
      setCreated(body);
      setLabel('');
      setShowForm(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (
      !confirm('Revoke this token? Any script using it will stop working.')
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/me/tokens/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!open) return null;

  return (
    <div
      className="upload-modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tokens-title"
      onClick={onClose}
    >
      <div className="upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="upload-modal-header">
          <h2 id="tokens-title">Import tokens</h2>
          <button
            type="button"
            className="upload-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="upload-modal-body">
          <p className="upload-hint">
            Long-lived credentials for scripts and scheduled tasks. Each
            token is the same as a logged-in browser session — revoke any
            you don't recognize.
          </p>

          {error && <div className="upload-error">{error}</div>}

          {created && (
            <div className="token-just-created">
              <strong>Token created.</strong>
              <p>This is the only time you'll see this value — copy it now.</p>
              <code className="token-value">{created.cookie_value}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(created.cookie_value);
                }}
              >
                <Copy size={14} strokeWidth={2} aria-hidden="true" /> Copy
              </button>
              <p className="upload-hint">
                Send it as a cookie named{' '}
                <code>{created.cookie_name}</code>.
              </p>
              <button type="button" onClick={() => setCreated(null)}>
                Done
              </button>
            </div>
          )}

          {!showForm && !created && (
            <button type="button" onClick={() => setShowForm(true)}>
              Create new token
            </button>
          )}

          {showForm && (
            <form onSubmit={(e) => void handleCreate(e)}>
              <label className="upload-field">
                <span>Label</span>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. Model 12 importer on my MBP"
                  autoFocus
                />
              </label>
              <button type="submit" disabled={creating || !label.trim()}>
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setLabel('');
                }}
              >
                Cancel
              </button>
            </form>
          )}

          {tokens === null ? (
            <p>Loading…</p>
          ) : tokens.length === 0 ? (
            <p className="upload-hint">No import tokens yet.</p>
          ) : (
            <ul className="token-list">
              {tokens.map((t) => (
                <li key={t.id} className="token-row">
                  <span className="token-label">{t.label}</span>
                  <span className="token-meta">
                    created{' '}
                    {new Date(t.created_at * 1000).toLocaleDateString()}
                    {t.last_used_at
                      ? ` · last used ${new Date(
                          t.last_used_at * 1000,
                        ).toLocaleDateString()}`
                      : ' · never used'}
                  </span>
                  <button type="button" onClick={() => void handleRevoke(t.id)}>
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
