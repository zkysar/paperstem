type State = 'active' | 'idle';
type Opts = { now?: () => number; url?: string; linkToken?: string };

export type PresenceRowDto = {
  userId: string | null;
  displayName: string;
  emailLocal: string | null;
  state: State;
  lastBeatAt: number;
};
export type Snapshot = {
  rows: PresenceRowDto[];
  anonymousCount: number;
};
type Listener = (projectId: string, snap: Snapshot) => void;

export type PresenceClient = {
  computeState(): State;
  connect(): void;
  disconnect(): void;
  subscribe(consumerId: string, projectIds: string[]): void;
  setPresentIn(projectId: string | null): void;
  addListener(fn: Listener): () => void;
  getSnapshot(projectId: string): Snapshot;
};

const BEAT_INTERVAL_MS = 10_000;
const IDLE_MS = 60_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export function createPresenceClient(opts: Opts = {}): PresenceClient {
  const now = opts.now ?? (() => Date.now());
  let lastInputAt = now();
  let ws: WebSocket | null = null;
  let reconnectAttempts = 0;
  const consumers = new Map<string, Set<string>>();
  const subscribed = new Set<string>();
  const presentIn = new Set<string>();
  const snapshots = new Map<string, Snapshot>();
  const listeners = new Set<Listener>();
  let lastSentState: State | null = null;

  const onInput = () => { lastInputAt = now(); };
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', onInput);
    window.addEventListener('mousemove', onInput);
    window.addEventListener('keydown', onInput);
    window.addEventListener('pointerdown', onInput);
    document.addEventListener('mousemove', onInput);
    document.addEventListener('keydown', onInput);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onInput();
      sendBeatNow();
    });
  }

  function computeState(): State {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return 'idle';
    return now() - lastInputAt < IDLE_MS ? 'active' : 'idle';
  }

  function defaultUrl(): string {
    if (typeof window === 'undefined') return '';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = `${proto}//${window.location.host}/ws/presence`;
    return opts.linkToken ? `${base}?link=${encodeURIComponent(opts.linkToken)}` : base;
  }

  function send(obj: unknown) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  }

  function sendSubscribe() {
    send({ type: 'subscribe', projectIds: [...subscribed] });
  }

  function sendBeatNow() {
    const state = computeState();
    lastSentState = state;
    for (const projectId of presentIn) {
      send({ type: 'beat', projectId, state });
    }
  }

  function recomputeSubscribed() {
    // The WS-level subscription is the union of consumer read-subscriptions
    // and the projects this tab is present in. The server requires a project
    // to be subscribed before it accepts beats for it, so presentIn must be
    // a subset of the subscribed set we declare.
    const next = new Set<string>();
    for (const ids of consumers.values()) {
      for (const id of ids) next.add(id);
    }
    for (const id of presentIn) next.add(id);
    let changed = next.size !== subscribed.size;
    if (!changed) {
      for (const id of next) if (!subscribed.has(id)) { changed = true; break; }
    }
    if (changed) {
      subscribed.clear();
      for (const id of next) subscribed.add(id);
      sendSubscribe();
    }
  }

  function emit(projectId: string, snap: Snapshot) {
    snapshots.set(projectId, snap);
    for (const fn of listeners) fn(projectId, snap);
  }

  function onMessage(evt: MessageEvent) {
    let msg: any;
    try { msg = JSON.parse(typeof evt.data === 'string' ? evt.data : ''); } catch { return; }
    if (msg?.type === 'presence' && typeof msg.projectId === 'string') {
      emit(msg.projectId, { rows: msg.rows ?? [], anonymousCount: msg.anonymousCount ?? 0 });
    }
  }

  let beatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (ws) return;
    const url = opts.url ?? defaultUrl();
    ws = new WebSocket(url);
    ws.onopen = () => {
      reconnectAttempts = 0;
      sendSubscribe();
      sendBeatNow();
      beatTimer = setInterval(() => {
        const state = computeState();
        if (state !== lastSentState) sendBeatNow();
        else for (const projectId of presentIn) send({ type: 'beat', projectId, state });
      }, BEAT_INTERVAL_MS);
    };
    ws.onmessage = onMessage;
    ws.onclose = () => {
      if (beatTimer) { clearInterval(beatTimer); beatTimer = null; }
      ws = null;
      const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** reconnectAttempts);
      reconnectAttempts++;
      const jittered = delay * (0.5 + Math.random() * 0.5);
      reconnectTimer = setTimeout(connect, jittered);
    };
  }

  function disconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (beatTimer) { clearInterval(beatTimer); beatTimer = null; }
    ws?.close();
    ws = null;
  }

  function subscribe(consumerId: string, projectIds: string[]) {
    consumers.set(consumerId, new Set(projectIds));
    recomputeSubscribed();
  }

  function setPresentIn(projectId: string | null) {
    const next = new Set<string>();
    if (projectId) next.add(projectId);
    let changed = next.size !== presentIn.size;
    if (!changed) {
      for (const id of next) if (!presentIn.has(id)) { changed = true; break; }
    }
    if (!changed) return;
    presentIn.clear();
    for (const id of next) presentIn.add(id);
    recomputeSubscribed();
    sendBeatNow();
  }

  function addListener(fn: Listener): () => void {
    listeners.add(fn);
    for (const [projectId, snap] of snapshots) fn(projectId, snap);
    return () => { listeners.delete(fn); };
  }

  function getSnapshot(projectId: string): Snapshot {
    return snapshots.get(projectId) ?? { rows: [], anonymousCount: 0 };
  }

  return { computeState, connect, disconnect, subscribe, setPresentIn, addListener, getSnapshot };
}
