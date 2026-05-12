import { useCallback, useEffect, useState } from 'react';
import type { User } from '../../shared/types';

type State = {
  user: User | null;
  loading: boolean;
};

export function useSession() {
  const [state, setState] = useState<State>({ user: null, loading: true });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      if (res.ok) {
        const data = (await res.json()) as { user: User };
        setState({ user: data.user, loading: false });
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { devLoginUrl?: string }
        | null;
      if (body?.devLoginUrl) {
        const devRes = await fetch(body.devLoginUrl, { credentials: 'include' });
        if (devRes.ok) {
          const retry = await fetch('/api/me', { credentials: 'include' });
          if (retry.ok) {
            const data = (await retry.json()) as { user: User };
            setState({ user: data.user, loading: false });
            return;
          }
        }
      }
      setState({ user: null, loading: false });
    } catch {
      setState({ user: null, loading: false });
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
    setState({ user: null, loading: false });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { user: state.user, loading: state.loading, refresh, logout };
}
