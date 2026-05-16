import { describe, expect, it } from 'vitest';
import { createRegistry } from './presence.js';

describe('presence registry — addOrUpdate', () => {
  it('inserts a new row and returns the affected projects', () => {
    const reg = createRegistry({ now: () => 1000 });
    const affected = reg.addOrUpdate('conn-1', 'proj-A', {
      userId: 'u-1',
      displayName: 'Alice',
      state: 'active',
      isAnonymous: false,
    });
    expect(affected).toEqual(['proj-A']);
    const snap = reg.snapshot('proj-A');
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0]).toMatchObject({
      connId: 'conn-1',
      userId: 'u-1',
      displayName: 'Alice',
      state: 'active',
      lastBeatAt: 1000,
      isAnonymous: false,
    });
    expect(snap.anonymousCount).toBe(0);
  });

  it('updates an existing row in place and counts anonymous separately', () => {
    let t = 1000;
    const reg = createRegistry({ now: () => t });
    reg.addOrUpdate('conn-1', 'proj-A', {
      userId: 'u-1', displayName: 'Alice',
      state: 'active', isAnonymous: false,
    });
    t = 5000;
    reg.addOrUpdate('conn-1', 'proj-A', {
      userId: 'u-1', displayName: 'Alice',
      state: 'idle', isAnonymous: false,
    });
    reg.addOrUpdate('conn-2', 'proj-A', {
      userId: null, displayName: '',
      state: 'active', isAnonymous: true,
    });
    const snap = reg.snapshot('proj-A');
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0].state).toBe('idle');
    expect(snap.rows[0].lastBeatAt).toBe(5000);
    expect(snap.anonymousCount).toBe(1);
  });
});

describe('presence registry — removeConn', () => {
  it('removes rows for a conn across all projects and returns affected projects sorted', () => {
    const reg = createRegistry({ now: () => 1000 });
    reg.addOrUpdate('conn-1', 'proj-A', { userId: 'u-1', displayName: 'A', state: 'active', isAnonymous: false });
    reg.addOrUpdate('conn-1', 'proj-B', { userId: 'u-1', displayName: 'A', state: 'active', isAnonymous: false });
    reg.addOrUpdate('conn-2', 'proj-A', { userId: 'u-2', displayName: 'B', state: 'active', isAnonymous: false });
    const affected = reg.removeConn('conn-1');
    expect(affected.sort()).toEqual(['proj-A', 'proj-B']);
    expect(reg.snapshot('proj-A').rows).toHaveLength(1);
    expect(reg.snapshot('proj-B').rows).toHaveLength(0);
  });

  it('removes empty project maps so subscribedProjects shrinks', () => {
    const reg = createRegistry({ now: () => 1000 });
    reg.addOrUpdate('conn-1', 'proj-A', { userId: 'u-1', displayName: 'A', state: 'active', isAnonymous: false });
    reg.removeConn('conn-1');
    expect(reg.subscribedProjects()).toEqual([]);
  });
});

describe('presence registry — sweep', () => {
  it('drops rows older than maxAgeMs and returns affected projects', () => {
    let t = 1000;
    const reg = createRegistry({ now: () => t });
    reg.addOrUpdate('conn-1', 'proj-A', { userId: 'u-1', displayName: 'A', state: 'active', isAnonymous: false });
    reg.addOrUpdate('conn-2', 'proj-A', { userId: 'u-2', displayName: 'B', state: 'active', isAnonymous: false });
    t = 1000 + 35_000;
    reg.addOrUpdate('conn-2', 'proj-A', { userId: 'u-2', displayName: 'B', state: 'active', isAnonymous: false });
    // conn-1 hasn't beat in 35s; conn-2 just did.
    const affected = reg.sweep(30_000);
    expect(affected).toEqual(['proj-A']);
    expect(reg.snapshot('proj-A').rows.map((r) => r.connId)).toEqual(['conn-2']);
  });

  it('returns empty array when nothing was swept', () => {
    const reg = createRegistry({ now: () => 1000 });
    reg.addOrUpdate('conn-1', 'proj-A', { userId: 'u-1', displayName: 'A', state: 'active', isAnonymous: false });
    expect(reg.sweep(30_000)).toEqual([]);
  });
});

describe('presence registry — removeConnFromProject', () => {
  it('removes a single (conn, project) pair without touching other projects', () => {
    const reg = createRegistry({ now: () => 1000 });
    reg.addOrUpdate('conn-1', 'proj-A', { userId: 'u-1', displayName: 'A', state: 'active', isAnonymous: false });
    reg.addOrUpdate('conn-1', 'proj-B', { userId: 'u-1', displayName: 'A', state: 'active', isAnonymous: false });
    const affected = reg.removeConnFromProject('conn-1', 'proj-A');
    expect(affected).toEqual(['proj-A']);
    expect(reg.snapshot('proj-A').rows).toHaveLength(0);
    expect(reg.snapshot('proj-B').rows).toHaveLength(1);
  });

  it('returns empty array when the (conn, project) pair did not exist', () => {
    const reg = createRegistry({ now: () => 1000 });
    expect(reg.removeConnFromProject('conn-x', 'proj-Z')).toEqual([]);
  });

  it('cleans up empty project maps after removal', () => {
    const reg = createRegistry({ now: () => 1000 });
    reg.addOrUpdate('conn-1', 'proj-A', { userId: 'u-1', displayName: 'A', state: 'active', isAnonymous: false });
    reg.removeConnFromProject('conn-1', 'proj-A');
    expect(reg.subscribedProjects()).toEqual([]);
  });
});
