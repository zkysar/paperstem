import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Stub the singleton module so the hook test doesn't open a real socket.
const subscribeMock = vi.fn();
const addListenerMock = vi.fn();
const getSnapshotMock = vi.fn();
const listeners: Array<(p: string, s: any) => void> = [];

vi.mock('../lib/presence-client', () => ({
  createPresenceClient: () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    computeState: () => 'active',
    subscribe: subscribeMock,
    setPresentIn: vi.fn(),
    addListener: (fn: any) => { listeners.push(fn); addListenerMock(fn); return () => {}; },
    getSnapshot: getSnapshotMock,
  }),
}));

import { usePresence } from './usePresence';
import { PresenceProvider } from './usePresenceConnection';

beforeEach(() => {
  subscribeMock.mockClear();
  addListenerMock.mockClear();
  getSnapshotMock.mockReset();
  getSnapshotMock.mockReturnValue({ rows: [], anonymousCount: 0 });
  listeners.length = 0;
});

describe('usePresence', () => {
  it('calls subscribe with the requested project ids on mount and again on change', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PresenceProvider>{children}</PresenceProvider>
    );
    const { rerender } = renderHook(({ ids }) => usePresence(ids), {
      wrapper,
      initialProps: { ids: ['p1', 'p2'] },
    });
    const firstCall = subscribeMock.mock.calls.at(-1);
    expect(firstCall?.[1].sort()).toEqual(['p1', 'p2']);

    rerender({ ids: ['p1', 'p3'] });
    const secondCall = subscribeMock.mock.calls.at(-1);
    expect(secondCall?.[1].sort()).toEqual(['p1', 'p3']);
  });

  it('returns the latest snapshot when the client emits an event', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PresenceProvider>{children}</PresenceProvider>
    );
    const { result } = renderHook(() => usePresence(['p1']), { wrapper });
    act(() => {
      for (const fn of listeners) {
        fn('p1', { rows: [{ userId: 'u1', displayName: 'A', state: 'active', lastBeatAt: 1 }], anonymousCount: 0 });
      }
    });
    expect(result.current.p1.rows[0].displayName).toBe('A');
  });
});
