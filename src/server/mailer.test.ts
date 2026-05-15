import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { BugReportPayload } from './mailer.js';

// mailer.ts reads GMAIL_USER and GMAIL_APP_PASSWORD at module init time and
// throws if either is missing. Set placeholders before the static import below.
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';

const mailer = await import('./mailer.js');

const {
  formatBugReportSubject,
  formatBugReportText,
  formatMentionEmailSubject,
  formatBatchedDigestSubject,
  formatBatchedDigestText,
  formatDailyDigestSubject,
} = mailer;

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

describe('formatMentionEmailSubject', () => {
  it('returns the expected subject for normal inputs', () => {
    expect(formatMentionEmailSubject({ authorName: 'Sarah', projectName: 'Mix v3', preview: 'bass is buried' }))
      .toBe('Sarah on "Mix v3": bass is buried');
  });

  it('truncates to ≤80 chars with … suffix when over', () => {
    const preview = 'a'.repeat(100);
    const result = formatMentionEmailSubject({ authorName: 'Sarah', projectName: 'Mix v3', preview });
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('formatBatchedDigestSubject', () => {
  it('returns single-event format for 1 group with 1 event', () => {
    const groups = [{ projectName: 'Mix v3', events: [{ authorName: 'A', preview: 'nice take' }] }];
    expect(formatBatchedDigestSubject(groups)).toBe('A on "Mix v3": nice take');
  });

  it('returns plural comment count format for 1 group with 2 events', () => {
    const groups = [{ projectName: 'Mix v3', events: [{ authorName: 'A', preview: 'x' }, { authorName: 'B', preview: 'y' }] }];
    expect(formatBatchedDigestSubject(groups)).toBe('2 new comments on "Mix v3"');
  });

  it('returns activity-in-N-projects format for 2 groups', () => {
    const groups = [
      { projectName: 'Mix v3', events: [{ authorName: 'A', preview: 'x' }] },
      { projectName: 'Drums', events: [{ authorName: 'B', preview: 'y' }] },
    ];
    expect(formatBatchedDigestSubject(groups)).toBe('Activity in 2 projects');
  });
});

describe('formatDailyDigestSubject', () => {
  it('prefixes with [Paperstem] Daily summary —', () => {
    const groups = [{ projectName: 'Mix v3', events: [{ authorName: 'A', preview: 'x' }] }];
    const result = formatDailyDigestSubject(groups);
    expect(result.startsWith('[Paperstem] Daily summary —')).toBe(true);
  });
});

describe('formatBatchedDigestText', () => {
  it('produces a grouped body with bullets per event and the footer', () => {
    const groups = [
      { projectName: 'Mix v3', events: [{ authorName: 'Alice', preview: 'bass is buried' }] },
    ];
    const text = formatBatchedDigestText(
      groups,
      (_g, _ev, _idx) => 'https://app/c1',
      { settingsLink: 'https://app/s', muteBandLink: 'https://app/m' },
    );
    expect(text).toContain('In "Mix v3":');
    expect(text).toContain('  • Alice: bass is buried');
    expect(text).toContain('    https://app/c1');
    expect(text).toContain('Mute: https://app/m');
    expect(text).toContain('Notification settings: https://app/s');
    expect(text).toContain('— Paperstem');
  });
});

describe('sendMentionEmail', () => {
  let sendMailSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sendMailSpy = vi.fn().mockResolvedValue({});
    (mailer._transporter as unknown as { sendMail: typeof sendMailSpy }).sendMail = sendMailSpy;
  });
  it('uses Reply-To header with reply-token address', async () => {
    await mailer.sendMentionEmail({
      to: 'b@e.test', authorName: 'A', projectName: 'P', preview: 'x',
      commentLink: 'https://app/x', muteBandLink: 'https://app/m', settingsLink: 'https://app/s',
      replyToken: 'tok123', inboundDomain: 'mail.paperstem.app',
    });
    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    const arg = sendMailSpy.mock.calls[0][0];
    expect(arg.replyTo).toBe('replies+tok123@mail.paperstem.app');
    expect(arg.to).toBe('b@e.test');
    expect(arg.subject).toBe('A on "P": x');
  });
});

describe('sendDigestEmail', () => {
  let sendMailSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sendMailSpy = vi.fn().mockResolvedValue({});
    (mailer._transporter as unknown as { sendMail: typeof sendMailSpy }).sendMail = sendMailSpy;
  });
  it('uses Reply-To with representative token and uses daily subject when daily=true', async () => {
    await mailer.sendDigestEmail({
      to: 'b@e.test', daily: true,
      groups: [{ projectName: 'P', events: [{ authorName: 'A', preview: 'x' }] }],
      linkBuilder: () => 'https://app/c',
      settingsLink: 'https://app/s',
      representativeReplyToken: 'tokZ',
      inboundDomain: 'mail.x',
    });
    const arg = sendMailSpy.mock.calls[0][0];
    expect(arg.replyTo).toBe('replies+tokZ@mail.x');
    expect(arg.subject).toMatch(/^\[Paperstem\] Daily summary —/);
  });
});
