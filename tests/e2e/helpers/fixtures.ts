import { test as base, expect, type Page } from '@playwright/test';
import { readServerInfo } from './server-info.js';

// Anything wider than this (relative to the visible viewport) is the kind of
// runaway-layout bug we want e2e to catch — see PR #133 (commit ffc23e0):
// a feedback loop between viewport-inner's explicit pixel width and the
// outer grid column let .stage grow geometrically per W keypress until
// Chrome hit its 16M-px ceiling and the tab froze.
//
// Comfortable upper bound: max horizontal zoom × 2. MAX_HZOOM is 32 in
// useViewport.ts; we double it so a momentary overshoot (e.g. zoom anchored
// at the edge of the stage) doesn't false-positive. Anything beyond this is
// a real bug, not a transient.
const VIEWPORT_INNER_MAX_RATIO = 64;

// The stage is sized to the viewport — its width should not exceed it by
// more than a token sub-pixel rounding margin regardless of zoom level.
const STAGE_MAX_RATIO = 1.5;

export type LayoutBound = {
  selector: string;
  /** Multiplier on viewport.width. Width > viewport.width * maxRatio fails. */
  maxRatio: number;
};

export const DEFAULT_LAYOUT_BOUNDS: LayoutBound[] = [
  { selector: '.stage', maxRatio: STAGE_MAX_RATIO },
  // .ruler and .viewport-inner are children of the zoomable inner content,
  // so they legitimately scale linearly with hZoom (up to MAX_HZOOM=32).
  // The PR #133 bug overshot that ceiling by orders of magnitude — we set
  // the bound at 64× to keep a generous overshoot margin for anchored zoom
  // and still catch the runaway case.
  { selector: '.ruler', maxRatio: VIEWPORT_INNER_MAX_RATIO },
  { selector: '.viewport-inner', maxRatio: VIEWPORT_INNER_MAX_RATIO },
];

export type ConsoleIssue = {
  type: 'error' | 'pageerror' | 'unhandledrejection';
  text: string;
};

type Fixtures = {
  /** Base URL of the dev server started in global-setup. */
  baseURL: string;
  /** Records of console errors / page errors / unhandled rejections that
   *  happened during the test. Asserted empty at the end of each test
   *  unless the test opts out. */
  consoleIssues: ConsoleIssue[];
  /** Long-task observer; tests use `app.expectNoLongTask(label, fn)` to
   *  wrap a specific interaction. */
  app: AppHarness;
};

export class AppHarness {
  constructor(
    readonly page: Page,
    readonly baseURL: string,
  ) {}

  /** Visit the SPA at `/`. The session cookie is established via the dev
   *  auto-login path when /api/me reports a null user, so by the time `goto` returns
   *  the user is authenticated and the ProjectPicker has opened. */
  async open(): Promise<void> {
    await this.page.goto(this.baseURL + '/');
    // The ProjectPicker auto-opens when no project is active. Wait for it to
    // be reachable; that doubles as the "auth resolved" signal because the
    // shell only renders after useSession returns user != null.
    await this.page
      .getByRole('dialog', { name: 'Projects' })
      .waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Pick the dev-seeded project. The seed creates a project named
   *  "Sample project" with three stems. We click the row's main button. */
  async openSampleProject(): Promise<void> {
    await this.openProjectNamed('Sample project');
  }

  /** Open a seeded project by (prefix-matched) name from the ProjectPicker,
   *  then wait until the player has mounted and at least one stem reports a
   *  non-zero duration. Used by openSampleProject and by journeys that target
   *  the seeded "Long sample project". */
  async openProjectNamed(name: string): Promise<void> {
    const row = this.page.getByRole('button', {
      name: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    });
    await row.first().click();
    // .stage exists once the player has mounted; duration becomes non-zero
    // once at least one stem has finished its metadata load. The toolbar
    // time readout shows `0:00 / M:SS` — so wait until it's not "0:00 / 0:00".
    await this.page.locator('.stage').waitFor({ state: 'visible' });
    await expect
      .poll(
        async () => {
          // The "0:00 / 0:00" string is only shown until at least one stem
          // reports a duration; wait for any non-zero denominator.
          const text = await this.page.locator('.atb-time').innerText();
          return /\/\s+(?!0:00)\d+:\d{2}/.test(text);
        },
        { timeout: 30_000 },
      )
      .toBeTruthy();
  }

  /** Measure `element.getBoundingClientRect().width` for each selector and
   *  assert it stays within `maxRatio × viewport.width`. Run after every
   *  gesture that changes layout (zoom step, drawer open, rail toggle). */
  async expectLayoutBounded(
    bounds: LayoutBound[] = DEFAULT_LAYOUT_BOUNDS,
  ): Promise<void> {
    const viewportSize = this.page.viewportSize();
    if (!viewportSize) throw new Error('viewportSize unavailable');
    const widths = await this.page.evaluate((selectors: string[]) => {
      return selectors.map((sel) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return { selector: sel, width: null as number | null };
        return { selector: sel, width: el.getBoundingClientRect().width };
      });
    }, bounds.map((b) => b.selector));
    for (const { selector, width } of widths) {
      if (width === null) continue; // selector might legitimately not exist this step
      const bound = bounds.find((b) => b.selector === selector)!;
      const limit = viewportSize.width * bound.maxRatio;
      expect(
        width,
        `${selector} width ${width.toFixed(1)}px exceeded ${limit.toFixed(1)}px ` +
          `(${bound.maxRatio}× viewport ${viewportSize.width}px) — likely runaway layout`,
      ).toBeLessThanOrEqual(limit);
    }
  }

  /** Run `fn` while a PerformanceObserver in the page collects Long Tasks
   *  (entries with duration > 50ms by the spec; we fail on any > 100ms,
   *  matching the prompt). Returns the offending entries for diagnostics. */
  async expectNoLongTask<T>(
    label: string,
    fn: () => Promise<T>,
    thresholdMs = 100,
  ): Promise<T> {
    await this.page.evaluate(() => {
      type LongTaskWindow = Window & {
        __paperstem_longTasks?: { duration: number; startTime: number }[];
        __paperstem_longTaskObs?: unknown;
      };
      const w = window as LongTaskWindow;
      w.__paperstem_longTasks = [];
      if (!w.__paperstem_longTaskObs) {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            w.__paperstem_longTasks!.push({
              duration: e.duration,
              startTime: e.startTime,
            });
          }
        });
        try {
          // 'longtask' is in the Long Tasks API draft — the `type` field
          // accepts it at runtime but the TS lib types don't list it.
          obs.observe({ type: 'longtask' as PerformanceEntryList[number]['entryType'], buffered: false });
          w.__paperstem_longTaskObs = obs;
        } catch {
          // longtask unsupported in this browser → silently skip; the test
          // still exercises the journey, just without the perf invariant.
        }
      }
    });
    const result = await fn();
    const entries = await this.page.evaluate(() => {
      type LongTaskWindow = Window & {
        __paperstem_longTasks?: { duration: number; startTime: number }[];
      };
      const w = window as LongTaskWindow;
      const out = w.__paperstem_longTasks ?? [];
      w.__paperstem_longTasks = [];
      return out;
    });
    const offenders = entries.filter((e) => e.duration > thresholdMs);
    expect(
      offenders,
      `${label}: ${offenders.length} long task(s) > ${thresholdMs}ms ` +
        `(${offenders.map((o) => o.duration.toFixed(0)).join(', ')}ms)`,
    ).toHaveLength(0);
    return result;
  }

  /** Press a key with optional delay between repeats. Useful for "press W
   *  three times to step the zoom" without coalescing the events. */
  async pressRepeat(key: string, times: number, delayMs = 40): Promise<void> {
    for (let i = 0; i < times; i++) {
      await this.page.keyboard.press(key);
      if (delayMs > 0 && i < times - 1) {
        await this.page.waitForTimeout(delayMs);
      }
    }
  }
}

export const test = base.extend<Fixtures>({
  baseURL: async ({}, use) => {
    const info = readServerInfo();
    await use(info.baseURL);
  },
  consoleIssues: async ({ page }, use) => {
    const issues: ConsoleIssue[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        issues.push({ type: 'error', text: msg.text() });
      }
    });
    page.on('pageerror', (err) => {
      // Playwright surfaces both synchronous JS errors and unhandled
      // promise rejections through `pageerror`. We don't separately listen
      // to `weberror` because it isn't stable across Playwright minor
      // versions.
      issues.push({ type: 'pageerror', text: `${err.name}: ${err.message}` });
    });
    await use(issues);
    // Console errors that didn't fail their own test (e.g. background
    // analytics retry) are still treated as failures — that's the point of
    // wrapping the whole journey. If a journey legitimately produces a
    // tolerable error, it can splice it out of `consoleIssues` before this
    // hook runs.
    if (issues.length > 0) {
      throw new Error(
        'console issues observed during test:\n' +
          issues.map((i) => `  [${i.type}] ${i.text}`).join('\n'),
      );
    }
  },
  app: async ({ page, baseURL }, use) => {
    await use(new AppHarness(page, baseURL));
  },
});

export { expect };
