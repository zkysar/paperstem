export type ClientErrorEntry = {
  ts: string;
  message: string;
  stack?: string;
};

const MAX_ENTRIES = 10;
const buffer: ClientErrorEntry[] = [];

function push(entry: ClientErrorEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message || value.name || 'Error';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function stackOf(value: unknown): string | undefined {
  if (value instanceof Error && typeof value.stack === 'string') return value.stack;
  return undefined;
}

export function recordClientError(error: unknown): void {
  push({
    ts: new Date().toISOString(),
    message: messageOf(error),
    stack: stackOf(error),
  });
}

export function getRecentClientErrors(): ClientErrorEntry[] {
  return buffer.slice();
}

export function clearClientErrorBuffer(): void {
  buffer.length = 0;
}

let installed = false;

export function installClientErrorBuffer(target: Window = window): void {
  if (installed) return;
  installed = true;
  target.addEventListener('error', (event) => {
    const e = event as ErrorEvent;
    push({
      ts: new Date().toISOString(),
      message: messageOf(e.error ?? e.message ?? 'error'),
      stack: stackOf(e.error),
    });
  });
  target.addEventListener('unhandledrejection', (event) => {
    const e = event as PromiseRejectionEvent;
    push({
      ts: new Date().toISOString(),
      message: messageOf(e.reason),
      stack: stackOf(e.reason),
    });
  });
}
