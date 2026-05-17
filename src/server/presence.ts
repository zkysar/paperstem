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
  removeConnFromProject(connId: string, projectId: string): string[];
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

  function removeConn(connId: string): string[] {
    const affected: string[] = [];
    for (const [projectId, m] of byProject) {
      if (m.delete(connId)) {
        affected.push(projectId);
        if (m.size === 0) byProject.delete(projectId);
      }
    }
    return affected;
  }

  function removeConnFromProject(connId: string, projectId: string): string[] {
    const m = byProject.get(projectId);
    if (!m || !m.delete(connId)) return [];
    if (m.size === 0) byProject.delete(projectId);
    return [projectId];
  }

  function sweep(maxAgeMs: number): string[] {
    const cutoff = now() - maxAgeMs;
    const affected = new Set<string>();
    for (const [projectId, m] of byProject) {
      for (const [connId, row] of m) {
        if (row.lastBeatAt < cutoff) {
          m.delete(connId);
          affected.add(projectId);
        }
      }
      if (m.size === 0) byProject.delete(projectId);
    }
    return [...affected];
  }
  function subscribedProjects(): string[] {
    return [...byProject.keys()];
  }

  return { addOrUpdate, removeConn, removeConnFromProject, sweep, snapshot, subscribedProjects };
}
