export type PresenceRow = {
  connId: string;
  userId: string | null;
  displayName: string;
  state: 'active' | 'idle';
  lastBeatAt: number;
  isAnonymous: boolean;
};

export type Snapshot = {
  rows: PresenceRow[];
  anonymousCount: number;
};

type Input = Omit<PresenceRow, 'connId' | 'lastBeatAt'>;

export type Registry = {
  addOrUpdate(connId: string, projectId: string, input: Input): string[];
  removeConn(connId: string): string[];
  sweep(maxAgeMs: number): string[];
  snapshot(projectId: string): Snapshot;
  subscribedProjects(): string[];
};

type Opts = { now?: () => number };

export function createRegistry(opts: Opts = {}): Registry {
  const now = opts.now ?? (() => Date.now());
  // projectId -> connId -> PresenceRow
  const byProject = new Map<string, Map<string, PresenceRow>>();

  function snapshot(projectId: string): Snapshot {
    const m = byProject.get(projectId);
    if (!m) return { rows: [], anonymousCount: 0 };
    const rows: PresenceRow[] = [];
    let anon = 0;
    for (const row of m.values()) {
      if (row.isAnonymous) anon++;
      else rows.push(row);
    }
    return { rows, anonymousCount: anon };
  }

  function addOrUpdate(connId: string, projectId: string, input: Input): string[] {
    let m = byProject.get(projectId);
    if (!m) {
      m = new Map();
      byProject.set(projectId, m);
    }
    m.set(connId, { ...input, connId, lastBeatAt: now() });
    return [projectId];
  }

  function removeConn(): string[] {
    return [];
  }
  function sweep(): string[] {
    return [];
  }
  function subscribedProjects(): string[] {
    return [...byProject.keys()];
  }

  return { addOrUpdate, removeConn, sweep, snapshot, subscribedProjects };
}
