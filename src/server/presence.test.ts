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
