import { useCallback, useEffect, useState } from 'react';
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
  // Bumping this counter triggers the effect to refetch. Used after the
  // user leaves a group so the active-band logic can move on.
  const [refreshTick, setRefreshTick] = useState(0);

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
  }, [enabled, refreshTick]);

  const refresh = useCallback(() => {
    setRefreshTick((n) => n + 1);
  }, []);

  return { ...state, refresh };
}
