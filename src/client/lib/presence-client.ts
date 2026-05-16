type State = 'active' | 'idle';
type Opts = { now?: () => number };

export type PresenceClient = {
  computeState(): State;
  // The remaining members (subscribe/beat/etc.) are filled in by later tasks.
};

export function createPresenceClient(opts: Opts = {}): PresenceClient {
  const now = opts.now ?? (() => Date.now());
  let lastInputAt = now();
  const IDLE_MS = 60_000;

  const onInput = () => {
    lastInputAt = now();
  };
  window.addEventListener('focus', onInput);
  window.addEventListener('mousemove', onInput);
  window.addEventListener('keydown', onInput);
  window.addEventListener('pointerdown', onInput);
  document.addEventListener('mousemove', onInput);
  document.addEventListener('keydown', onInput);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') lastInputAt = now();
  });

  function computeState(): State {
    if (document.visibilityState !== 'visible') return 'idle';
    return now() - lastInputAt < IDLE_MS ? 'active' : 'idle';
  }

  return { computeState };
}
