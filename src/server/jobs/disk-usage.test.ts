import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- env prelude: must run before any dynamic import of mailer / disk-usage ----
const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-disk-usage-test-'));
const audioRoot = join(tmpDir, 'audio');
mkdirSync(audioRoot, { recursive: true });
process.env.PAPERSTEM_AUDIO_ROOT = audioRoot;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';
process.env.DISK_ALERT_TO = 'ops@example.com';
delete process.env.BUG_REPORT_TO;

// statfs is a non-configurable ESM export, so we can't vi.spyOn it on the
// imported namespace. vi.mock with importActual swaps the binding before
// disk-usage.ts pulls it in, while leaving readFile / writeFile intact.
vi.mock('node:fs/promises', async () => {
  const actual =
    await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    statfs: vi.fn(),
  };
});

type DiskUsageModule = typeof import('./disk-usage.js');
type MailerModule = typeof import('../mailer.js');
type FsPromisesModule = typeof import('node:fs/promises');

let diskMod: DiskUsageModule;
let mailerMod: MailerModule;
let sendSpy: ReturnType<typeof vi.spyOn>;
let statfsMock: ReturnType<typeof vi.fn>;

const STATE_FILE = join(audioRoot, '.disk-alert-state.json');
const HOUR_MS = 60 * 60 * 1000;

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  rmSync(audioRoot, { recursive: true, force: true });
  mkdirSync(audioRoot, { recursive: true });
}

function setUsagePercent(percent: number) {
  const total = 100 * 1024 ** 3;
  const used = Math.floor((percent / 100) * total);
  const free = total - used;
  const bsize = 4096;
  statfsMock.mockResolvedValue({
    type: 0,
    bsize,
    blocks: total / bsize,
    bfree: free / bsize,
    bavail: free / bsize,
    files: 0,
    ffree: 0,
  });
}

function writeState(tier: 'ok' | 'warn' | 'urgent', sentAt: number) {
  writeFileSync(STATE_FILE, JSON.stringify({ tier, sentAt }), 'utf8');
}

function readPersistedState(): { tier: string; sentAt: number } {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

beforeEach(async () => {
  vi.resetModules();
  reset();
  const fsPromises: FsPromisesModule = await import('node:fs/promises');
  statfsMock = fsPromises.statfs as unknown as ReturnType<typeof vi.fn>;
  statfsMock.mockReset();
  mailerMod = await import('../mailer.js');
  sendSpy = vi
    .spyOn(mailerMod, 'sendDiskUsageAlert')
    .mockResolvedValue(undefined as never);
  diskMod = await import('./disk-usage.js');
});

describe('decideAction', () => {
  it('ok → noop when under 80%', () => {
    const action = diskMod.decideAction({ tier: 'ok', sentAt: 0 }, 50, 1_000_000);
    expect(action.kind).toBe('noop');
  });

  it('warn → noop when re-checked within 24h still in warn band', () => {
    const sentAt = 1_000_000;
    const action = diskMod.decideAction(
      { tier: 'warn', sentAt },
      82,
      sentAt + HOUR_MS,
    );
    expect(action.kind).toBe('noop');
  });

  it('warn → re-send warn after >24h', () => {
    const sentAt = 1_000_000;
    const action = diskMod.decideAction(
      { tier: 'warn', sentAt },
      82,
      sentAt + 25 * HOUR_MS,
    );
    expect(action.kind).toBe('send');
    if (action.kind === 'send') expect(action.tier).toBe('warn');
  });

  it('urgent → reset when drops under 80', () => {
    const action = diskMod.decideAction(
      { tier: 'urgent', sentAt: 1_000_000 },
      70,
      2_000_000,
    );
    expect(action.kind).toBe('reset');
    expect(action.nextState.tier).toBe('ok');
  });
});

describe('runDiskUsageCheckNow', () => {
  it('under-threshold: no email, no state written', async () => {
    setUsagePercent(50);
    await diskMod.runDiskUsageCheckNow();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(existsSync(STATE_FILE)).toBe(false);
  });

  it('crossing into 80% emails warn once and persists state', async () => {
    setUsagePercent(82);
    await diskMod.runDiskUsageCheckNow();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const call = sendSpy.mock.calls[0]![0] as {
      to: string;
      tier: string;
      mountpoint: string;
    };
    expect(call.to).toBe('ops@example.com');
    expect(call.tier).toBe('warn');
    expect(call.mountpoint).toBe(audioRoot);
    const persisted = readPersistedState();
    expect(persisted.tier).toBe('warn');
    expect(persisted.sentAt).toBeGreaterThan(0);
  });

  it('second run within 24h at same tier does not re-email', async () => {
    setUsagePercent(82);
    await diskMod.runDiskUsageCheckNow();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    await diskMod.runDiskUsageCheckNow();
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('crossing into 95% from warn emails urgent (different tier)', async () => {
    writeState('warn', Date.now() - HOUR_MS);
    setUsagePercent(96);
    await diskMod.runDiskUsageCheckNow();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const call = sendSpy.mock.calls[0]![0] as { tier: string };
    expect(call.tier).toBe('urgent');
    expect(readPersistedState().tier).toBe('urgent');
  });

  it('drop back under 80 from warn resets state and re-arms future alerts', async () => {
    writeState('warn', Date.now() - HOUR_MS);
    setUsagePercent(70);
    await diskMod.runDiskUsageCheckNow();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(readPersistedState().tier).toBe('ok');

    setUsagePercent(85);
    await diskMod.runDiskUsageCheckNow();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(readPersistedState().tier).toBe('warn');
  });

  it('recipient fallback: BUG_REPORT_TO is used when DISK_ALERT_TO is unset', async () => {
    const prev = process.env.DISK_ALERT_TO;
    delete process.env.DISK_ALERT_TO;
    process.env.BUG_REPORT_TO = 'bugs@example.com';
    try {
      setUsagePercent(82);
      await diskMod.runDiskUsageCheckNow();
      const call = sendSpy.mock.calls[0]![0] as { to: string };
      expect(call.to).toBe('bugs@example.com');
    } finally {
      if (prev) process.env.DISK_ALERT_TO = prev;
      delete process.env.BUG_REPORT_TO;
    }
  });
});
