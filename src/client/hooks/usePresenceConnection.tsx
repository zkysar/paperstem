import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { createPresenceClient, type PresenceClient } from '../lib/presence-client';

const Ctx = createContext<PresenceClient | null>(null);
export const PresenceContext = Ctx;

export function PresenceProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => createPresenceClient(), []);
  useEffect(() => {
    client.connect();
    return () => { client.disconnect(); };
  }, [client]);
  return <Ctx.Provider value={client}>{children}</Ctx.Provider>;
}

export function usePresenceClient(): PresenceClient {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePresenceClient must be used inside <PresenceProvider>');
  return c;
}

// Declare which project this tab is currently *in*. Drives presence beats.
// Distinct from usePresence (which only reads roster snapshots). Pass null
// to leave all projects (e.g. when the picker is open with no project loaded).
export function usePresentIn(projectId: string | null): void {
  const client = usePresenceClient();
  useEffect(() => {
    client.setPresentIn(projectId);
    return () => { client.setPresentIn(null); };
  }, [client, projectId]);
}
