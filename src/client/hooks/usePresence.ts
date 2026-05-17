import { useEffect, useId, useMemo, useState } from 'react';
import { usePresenceClient } from './usePresenceConnection';
import type { Snapshot } from '../lib/presence-client';

export function usePresence(projectIds: string[]): Record<string, Snapshot> {
  const client = usePresenceClient();
  const consumerId = useId();
  const key = useMemo(() => [...projectIds].sort().join(','), [projectIds]);
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    client.subscribe(consumerId, ids);
    return () => { client.subscribe(consumerId, []); };
  }, [client, consumerId, key]);

  useEffect(() => {
    return client.addListener((projectId, snap) => {
      setSnapshots((prev) => ({ ...prev, [projectId]: snap }));
    });
  }, [client]);

  return useMemo(() => {
    const ids = key ? key.split(',') : [];
    const out: Record<string, Snapshot> = {};
    for (const id of ids) out[id] = snapshots[id] ?? { rows: [], anonymousCount: 0 };
    return out;
  }, [snapshots, key]);
}
