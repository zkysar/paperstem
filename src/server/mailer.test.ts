import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BugReportPayload } from './mailer.js';

// ---- env-var guard tests ------------------------------------------------
// mailer.ts reads GMAIL_USER and GMAIL_APP_PASSWORD at module init time and
// throws if either is missing.  We use vi.resetModules() + freshImport() so
// each test gets a clean module registry with whatever env is current.

const ORIGINAL_GMAIL_USER = process.env.GMAIL_USER;
const ORIGINAL_GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

async function freshImport() {
  vi.resetModules();
  return await import('./mailer.js');
}

afterEach(() => {
  if (ORIGINAL_GMAIL_USER === undefined) delete process.env.GMAIL_USER;
  else process.env.GMAIL_USER = ORIGINAL_GMAIL_USER;

  if (ORIGINAL_GMAIL_APP_PASSWORD === undefined) delete process.env.GMAIL_APP_PASSWORD;
  else process.env.GMAIL_APP_PASSWORD = ORIGINAL_GMAIL_APP_PASSWORD;
});

describe('mailer — env-var guard', () => {
  it('throws on import when GMAIL_USER is unset', async () => {
    delete process.env.GMAIL_USER;
    process.env.GMAIL_APP_PASSWORD = 'any-pass';
    await expect(freshImport()).rejects.toThrow('GMAIL_USER and GMAIL_APP_PASSWORD must be set');
  });

  it('throws on import when GMAIL_APP_PASSWORD is unset', async () => {
    process.env.GMAIL_USER = 'test@example.com';
    delete process.env.GMAIL_APP_PASSWORD;
    await expect(freshImport()).rejects.toThrow('GMAIL_USER and GMAIL_APP_PASSWORD must be set');
  });

  it('throws on import when both env vars are unset', async () => {
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    await expect(freshImport()).rejects.toThrow('GMAIL_USER and GMAIL_APP_PASSWORD must be set');
  });

  it('loads successfully when both env vars are set', async () => {
    process.env.GMAIL_USER = 'test@example.com';
    process.env.GMAIL_APP_PASSWORD = 'test-pass';
    await expect(freshImport()).resolves.toBeDefined();
  });
});

// ---- formatter tests -----------------------------------------------------
// formatBugReportSubject and formatBugReportText are pure (or near-pure)
// exported functions.  Import them statically; they do not read env vars at
// call time, and we can restore GMAIL_USER/PASSWORD before the static import
// runs by setting them at module level here.

process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

// Static import — safe because env vars are set above before the module loads.
const { formatBugReportSubject, formatBugReportText } = await import('./mailer.js');

function makePayload(overrides: Partial<BugReportPayload> = {}): BugReportPayload {
  return {
    reporterEmail: 'reporter@example.com',
    reporterUserId: 'u1',
    description: 'Something broke',
    url: 'https://paperstem.fly.dev/projects/p1',
    viewport: { w: 1440, h: 900 },
    userAgent: 'Mozilla/5.0 (Test)',
    pageContext: {},
    recentErrors: [],
    appVersion: 'v1.2.3',
    appVersionUrl: 'https://github.com/org/paperstem/releases/tag/v1.2.3',
    ...overrides,
  };
}

describe('formatBugReportSubject', () => {
  it('prefixes the description with [Paperstem bug]', () => {
    expect(formatBugReportSubject('Widget crash')).toBe('[Paperstem bug] Widget crash');
  });

  it('truncates the description to 80 characters', () => {
    const long = 'a'.repeat(100);
    const result = formatBugReportSubject(long);
    // "[Paperstem bug] " is 16 chars; content is capped at 80 chars
    expect(result).toBe(`[Paperstem bug] ${'a'.repeat(80)}`);
  });

  it('collapses internal whitespace (newlines, multiple spaces) to a single space', () => {
    expect(formatBugReportSubject('line one\nline two')).toBe('[Paperstem bug] line one line two');
    expect(formatBugReportSubject('too  many   spaces')).toBe('[Paperstem bug] too many spaces');
  });

  it('uses (no description) when description is empty', () => {
    expect(formatBugReportSubject('')).toBe('[Paperstem bug] (no description)');
  });

  it('uses (no description) when description is only whitespace', () => {
    expect(formatBugReportSubject('   \n\t  ')).toBe('[Paperstem bug] (no description)');
  });
});

describe('formatBugReportText', () => {
  it('includes reporter email and user ID', () => {
    const text = formatBugReportText(makePayload());
    expect(text).toContain('reporter@example.com');
    expect(text).toContain('u1');
  });

  it('includes version and URL', () => {
    const text = formatBugReportText(makePayload());
    expect(text).toContain('v1.2.3');
    expect(text).toContain('https://paperstem.fly.dev/projects/p1');
  });

  it('includes viewport dimensions', () => {
    const text = formatBugReportText(makePayload({ viewport: { w: 800, h: 600 } }));
    expect(text).toContain('800');
    expect(text).toContain('600');
  });

  it('includes the description body', () => {
    const text = formatBugReportText(makePayload({ description: 'Button exploded' }));
    expect(text).toContain('Button exploded');
  });

  it('shows (none) for empty pageContext', () => {
    const text = formatBugReportText(makePayload({ pageContext: {} }));
    expect(text).toContain('(none)');
  });

  it('serialises non-empty pageContext as JSON', () => {
    const text = formatBugReportText(makePayload({ pageContext: { bandId: 'b1', mode: 'play' } }));
    expect(text).toContain('"bandId": "b1"');
    expect(text).toContain('"mode": "play"');
  });

  it('shows (none) for zero recent errors', () => {
    const text = formatBugReportText(makePayload({ recentErrors: [] }));
    expect(text).toContain('Recent client errors (0)');
    expect(text).toContain('(none)');
  });

  it('lists each recent error with its HH:MM:SS timestamp', () => {
    const text = formatBugReportText(
      makePayload({
        recentErrors: [{ ts: '2026-05-14T13:45:01.000Z', message: 'TypeError: null' }],
      }),
    );
    expect(text).toContain('Recent client errors (1)');
    expect(text).toContain('[13:45:01] TypeError: null');
  });

  it('extracts the first non-message stack line when stack is present', () => {
    const text = formatBugReportText(
      makePayload({
        recentErrors: [
          {
            ts: '2026-05-14T13:45:01.000Z',
            message: 'TypeError: null',
            stack: 'TypeError: null\n    at Player.ts:42\n    at App.ts:7',
          },
        ],
      }),
    );
    // firstStackLine skips the first line (same as message) and returns the next
    expect(text).toContain('at Player.ts:42');
  });

  it('shows [Attachment: screenshot.png] when screenshotPng is present', () => {
    const text = formatBugReportText(
      makePayload({ screenshotPng: Buffer.from('fake png') }),
    );
    expect(text).toContain('[Attachment: screenshot.png]');
    expect(text).not.toContain('[No screenshot attached]');
  });

  it('shows [No screenshot attached] when screenshotPng is absent', () => {
    const text = formatBugReportText(makePayload());
    expect(text).toContain('[No screenshot attached]');
    expect(text).not.toContain('[Attachment: screenshot.png]');
  });
});
