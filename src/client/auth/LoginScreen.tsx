import { useState } from 'react';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
        credentials: 'include',
      });
      if (!res.ok) {
        setError(`Something went wrong (HTTP ${res.status}).`);
        setSubmitting(false);
        return;
      }
      setSubmitted(trimmed);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setSubmitted(null);
    setError(null);
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="brand">Paperstem</h1>
        <div className="brand-tag">Sign in</div>
        {submitted ? (
          <>
            <p className="login-msg">
              Check your inbox at <strong>{submitted}</strong> for a sign-in
              link.
            </p>
            <button
              type="button"
              className="login-link"
              onClick={reset}
            >
              Use a different email
            </button>
          </>
        ) : (
          <form onSubmit={onSubmit} className="login-form">
            <label className="login-label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="login-input"
              placeholder="you@example.com"
            />
            <button
              type="submit"
              className="login-submit"
              disabled={submitting || !email.trim()}
            >
              {submitting ? 'Sending…' : 'Send me a sign-in link'}
            </button>
            {error && <div className="login-error">{error}</div>}
          </form>
        )}
      </div>
    </div>
  );
}
