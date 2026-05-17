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
