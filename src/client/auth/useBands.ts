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

  // Optimistically remove a band from the local list. Used by the leave
  // flow: drops the band before the server-side refresh lands, so the
  // active-band fallback in App.tsx doesn't briefly re-elect the band the
  // user just left and fire requests against a band they no longer belong
  // to. The next real refresh will reconcile.
  const dropLocally = useCallback((id: string) => {
    setState((s) => ({ ...s, bands: s.bands.filter((b) => b.id !== id) }));
  }, []);

  // Optimistically add a band to the local list. Used by the create flow:
  // pushes the new band locally so the parent's `bands.length === 0`
  // branch lets go of the empty state immediately, without waiting for the
  // server-side refresh to land.
  const addLocally = useCallback((band: BandWithRole) => {
    setState((s) =>
      s.bands.some((b) => b.id === band.id)
        ? s
        : { ...s, bands: [...s.bands, band] },
    );
  }, []);

  return { ...state, refresh, dropLocally, addLocally };
}
