// FIFO semaphore shared across the module. Used by WaveformThumb so that
// opening the picker on a band with many projects doesn't kick off N
// simultaneous fetches and decodes — at ~5MB per reference stem that would
// saturate the connection and stall the main thread.

const MAX_CONCURRENT = 3;
let active = 0;
const waiters: Array<() => void> = [];

function release(): void {
  const next = waiters.shift();
  if (next) {
    next();
  } else {
    active--;
  }
}

export async function acquire(): Promise<() => void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return release;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  return release;
}
