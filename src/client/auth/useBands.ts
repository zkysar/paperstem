import { useEffect, useState } from 'react';
import type { BandWithRole } from '../../shared/types';

type State = {
  bands: BandWithRole[];
  loading: boolean;
  error: string | null;
};

export function useBands(enabled: boolean) {
  const [state, setState] = useState<State>({
    bands: [],
    loading: enabled,
    error: null,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ bands: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch('/api/bands', { credentials: 'include' }).then(
      async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState({ bands: [], loading: false, error: `HTTP ${res.status}` });
          return;
        }
        const data = (await res.json()) as { bands: BandWithRole[] };
        setState({ bands: data.bands, loading: false, error: null });
      },
      (err: Error) => {
        if (!cancelled) {
          setState({ bands: [], loading: false, error: err.message });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}
