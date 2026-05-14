import { readFile, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sendDiskUsageAlert } from '../mailer.js';

const STATE_FILENAME = '.disk-alert-state.json';
const DAY_MS = 24 * 60 * 60 * 1000;
const WARN_THRESHOLD = 80;
const URGENT_THRESHOLD = 95;

export type AlertTier = 'ok' | 'warn' | 'urgent';

export type AlertState = {
  tier: AlertTier;
  sentAt: number;
};

export type DiskUsage = {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  percentUsed: number;
};

export type TransitionAction =
  | { kind: 'noop'; nextState: AlertState }
  | { kind: 'send'; tier: 'warn' | 'urgent'; nextState: AlertState }
  | { kind: 'reset'; nextState: AlertState };

function audioRoot(): string {
  return process.env.PAPERSTEM_AUDIO_ROOT || '/data';
}

function stateFilePath(): string {
  return join(audioRoot(), STATE_FILENAME);
}

export async function readState(): Promise<AlertState> {
  try {
    const raw = await readFile(stateFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AlertState>;
    const tier: AlertTier =
      parsed.tier === 'warn' || parsed.tier === 'urgent' ? parsed.tier : 'ok';
    const sentAt = typeof parsed.sentAt === 'number' ? parsed.sentAt : 0;
    return { tier, sentAt };
  } catch {
    return { tier: 'ok', sentAt: 0 };
  }
}

export async function writeState(state: AlertState): Promise<void> {
  await writeFile(stateFilePath(), JSON.stringify(state), 'utf8');
}

export async function measureUsage(path: string): Promise<DiskUsage> {
  const s = await statfs(path);
  const totalBytes = s.blocks * s.bsize;
  const freeBytes = s.bavail * s.bsize;
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const percentUsed = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
  return { totalBytes, freeBytes, usedBytes, percentUsed };
}

export function decideAction(
  state: AlertState,
  percentUsed: number,
  nowMs: number,
): TransitionAction {
  const aboveUrgent = percentUsed >= URGENT_THRESHOLD;
  const aboveWarn = percentUsed >= WARN_THRESHOLD;

  if (state.tier === 'ok') {
    if (aboveUrgent) {
      return {
        kind: 'send',
        tier: 'urgent',
        nextState: { tier: 'urgent', sentAt: nowMs },
      };
    }
    if (aboveWarn) {
      return {
        kind: 'send',
        tier: 'warn',
        nextState: { tier: 'warn', sentAt: nowMs },
      };
    }
    return { kind: 'noop', nextState: state };
  }

  if (state.tier === 'warn') {
    if (aboveUrgent) {
      return {
        kind: 'send',
        tier: 'urgent',
        nextState: { tier: 'urgent', sentAt: nowMs },
      };
    }
    if (!aboveWarn) {
      return { kind: 'reset', nextState: { tier: 'ok', sentAt: nowMs } };
    }
    if (nowMs - state.sentAt > DAY_MS) {
      return {
        kind: 'send',
        tier: 'warn',
        nextState: { tier: 'warn', sentAt: nowMs },
      };
    }
    return { kind: 'noop', nextState: state };
  }

  // state.tier === 'urgent'
  if (!aboveWarn) {
    return { kind: 'reset', nextState: { tier: 'ok', sentAt: nowMs } };
  }
  if (nowMs - state.sentAt > DAY_MS) {
    const tier: 'warn' | 'urgent' = aboveUrgent ? 'urgent' : 'warn';
    return { kind: 'send', tier, nextState: { tier, sentAt: nowMs } };
  }
  return { kind: 'noop', nextState: state };
}

function recipient(): string {
  const explicit = process.env.DISK_ALERT_TO;
  if (explicit) return explicit;
  const bugReport = process.env.BUG_REPORT_TO;
  if (bugReport) return bugReport;
  return process.env.GMAIL_USER || '';
}

let runInFlight: Promise<void> | null = null;

export async function runDiskUsageCheckNow(): Promise<void> {
  if (runInFlight) return runInFlight;
  runInFlight = (async () => {
    const root = audioRoot();
    let usage: DiskUsage;
    try {
      usage = await measureUsage(root);
    } catch (err) {
      console.error(`[disk-usage] statfs ${root} failed:`, err);
      return;
    }

    const state = await readState();
    const now = Date.now();
    const action = decideAction(state, usage.percentUsed, now);

    if (action.kind === 'noop') {
      console.log(
        `[disk-usage] tier=${state.tier} used=${usage.percentUsed.toFixed(1)}% noop`,
      );
      return;
    }

    if (action.kind === 'send') {
      const to = recipient();
      if (!to) {
        console.error('[disk-usage] no recipient configured; skipping email');
        return;
      }
      try {
        await sendDiskUsageAlert({
          to,
          tier: action.tier,
          mountpoint: root,
          usage,
        });
        await writeState(action.nextState);
        console.log(
          `[disk-usage] tier=${action.tier} used=${usage.percentUsed.toFixed(1)}% emailed=${to}`,
        );
      } catch (err) {
        console.error('[disk-usage] sendDiskUsageAlert failed:', err);
      }
      return;
    }

    // reset
    try {
      await writeState(action.nextState);
      console.log(
        `[disk-usage] tier=ok used=${usage.percentUsed.toFixed(1)}% reset from ${state.tier}`,
      );
    } catch (err) {
      console.error('[disk-usage] writeState reset failed:', err);
    }
  })().finally(() => {
    runInFlight = null;
  });
  return runInFlight;
}
