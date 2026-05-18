import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPresenceClient } from './presence-client';

describe('presenceClient — input state detector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts active when document is visible and an input fires', () => {
    const c = createPresenceClient({ now: () => Date.now() });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('mousemove'));
    expect(c.computeState()).toBe('active');
  });

  it('flips to idle after 60s of no input', () => {
    const c = createPresenceClient({ now: () => Date.now() });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('mousemove'));
    expect(c.computeState()).toBe('active');
    vi.advanceTimersByTime(60_001);
    expect(c.computeState()).toBe('idle');
  });

  it('flips to idle when tab is hidden', () => {
    const c = createPresenceClient({ now: () => Date.now() });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('mousemove'));
    expect(c.computeState()).toBe('active');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(c.computeState()).toBe('idle');
  });
});

class MockSocket {
  static instances: MockSocket[] = [];
  // Match the real WebSocket constants so the implementation's
  // `readyState !== WebSocket.OPEN` check evaluates correctly when
  // globalThis.WebSocket is this class.
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    MockSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(payload: any) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe('presenceClient — WS lifecycle', () => {
  beforeEach(() => {
    MockSocket.instances.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T12:00:00Z'));
    (globalThis as any).WebSocket = MockSocket;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).WebSocket;
  });

  it('opens one socket and sends a subscribe with the union of requested project ids', () => {
    const c = createPresenceClient({ now: () => Date.now(), url: 'ws://test/ws/presence' });
    c.connect();
    const sock = MockSocket.instances[0];
    sock.open();
    c.subscribe('comp-A', ['p1', 'p2']);
    c.subscribe('comp-B', ['p2', 'p3']);
    const lastSubscribe = sock.sent
      .map((s) => JSON.parse(s))
      .filter((m) => m.type === 'subscribe')
      .pop();
    expect(lastSubscribe.projectIds.sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('emits snapshots to listeners when a presence message arrives', () => {
    const c = createPresenceClient({ now: () => Date.now(), url: 'ws://test/ws/presence' });
    c.connect();
    MockSocket.instances[0].open();
    c.subscribe('comp', ['p1']);
    const seen: any[] = [];
    c.addListener((proj, snap) => seen.push({ proj, snap }));
    MockSocket.instances[0].receive({
      type: 'presence', projectId: 'p1',
      rows: [{ userId: 'u1', displayName: 'Alice', state: 'active', lastBeatAt: 1000 }],
      anonymousCount: 0,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].proj).toBe('p1');
    expect(seen[0].snap.rows[0].displayName).toBe('Alice');
  });

  it('beats only for the project this tab is present in, not every subscribed project', () => {
    const c = createPresenceClient({ now: () => Date.now(), url: 'ws://test/ws/presence' });
    c.connect();
    MockSocket.instances[0].open();
    c.subscribe('comp', ['p1', 'p2', 'p3']);
    c.setPresentIn('p2');
    MockSocket.instances[0].sent.length = 0;
    vi.advanceTimersByTime(10_001);
    const beats = MockSocket.instances[0].sent
      .map((s) => JSON.parse(s))
      .filter((m) => m.type === 'beat');
    expect(beats.map((b) => b.projectId)).toEqual(['p2']);
  });

  it('does not beat when no project is set as present', () => {
    const c = createPresenceClient({ now: () => Date.now(), url: 'ws://test/ws/presence' });
    c.connect();
    MockSocket.instances[0].open();
    c.subscribe('comp', ['p1', 'p2']);
    MockSocket.instances[0].sent.length = 0;
    vi.advanceTimersByTime(10_001);
    const beats = MockSocket.instances[0].sent
      .map((s) => JSON.parse(s))
      .filter((m) => m.type === 'beat');
    expect(beats).toEqual([]);
  });

  it('setPresentIn adds the project to the WS subscribe set so server accepts beats', () => {
    const c = createPresenceClient({ now: () => Date.now(), url: 'ws://test/ws/presence' });
    c.connect();
    const sock = MockSocket.instances[0];
    sock.open();
    c.setPresentIn('only-present');
    const lastSubscribe = sock.sent
      .map((s) => JSON.parse(s))
      .filter((m) => m.type === 'subscribe')
      .pop();
    expect(lastSubscribe.projectIds).toContain('only-present');
  });
});
