import { flushPendingNotifications } from '../notifications-flush.js';

function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? 'http://localhost:5173';
}
function inboundDomain(): string {
  return process.env.INBOUND_DOMAIN ?? 'mail.paperstem.app';
}

export async function runBatchedFlushNow(): Promise<void> {
  await flushPendingNotifications({
    mode: 'batched',
    appBaseUrl: appBaseUrl(),
    inboundDomain: inboundDomain(),
  });
}

export async function runDailyFlushNow(): Promise<void> {
  await flushPendingNotifications({
    mode: 'daily',
    appBaseUrl: appBaseUrl(),
    inboundDomain: inboundDomain(),
  });
}
