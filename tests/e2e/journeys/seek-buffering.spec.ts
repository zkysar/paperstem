import { expect, test } from '../helpers/fixtures.js';
import type { Route } from '@playwright/test';

// Seek-into-unbuffered journey for the audio-buffering feature. When the
// playhead reaches audio not yet decoded — notably after seeking AHEAD past
// the decoded head/segments — playback stalls: the cursor freezes, a
// "Buffering…" pill appears (text "Buffering…", class `audio-loading-pill`),
// and it auto-resumes once the covering segment is fetched + decoded.
//
// This is the one timing-critical thing the unit/hook tests can't show: in a
// real Chromium, with a real AudioContext and real Range-backed segment
// fetches, a seek into an undecoded region freezes the cursor, shows the pill,
// and resumes when the segment arrives.
//
// DETERMINISM: we don't throttle bandwidth (flaky). Instead we intercept the
// audio Range requests with a Playwright route handler and HOLD the response
// for the segment that covers the seek target — the head + earlier segments
// pass through so playback can start, but the seeked segment is gated behind a
// promise the test releases on cue. That makes "stall, then resume" a
// scheduled event, not a race.
//
// The seeded stem (tests/e2e/fixtures/long-tone.mp3, wired via the
// PAPERSTEM_DEV_SEED_LONG_STEM seed in global-setup.ts) is a 60s 64 kbps mono
// CBR MP3 = 480488 bytes. The client plans 3 ~20s segments (segment-stream.ts
// planSegments): seg0 bytes 0–160161, seg1 158114–320324, seg2 318277–480487.
// seg2 covers ~40–60s, so a seek to ~45s lands in it. We hold any Range
// request whose start byte is >= the gate threshold (300000) — that uniquely
// matches seg2 (318277) and never the head probe (start 0) or seg1 (158114),
// even allowing for small byte drift from the probed metaDuration.
const HELD_SEGMENT_BYTE_THRESHOLD = 300_000;

// The clip is 60s; seek into the held segment (~45s = 0.75 of the ruler).
const SEEK_FRACTION = 0.75;
const SEEK_SECONDS = 45;

function rangeStart(headerValue: string | null): number | null {
  if (!headerValue) return null;
  // "bytes=<start>-<end>"
  const m = /bytes=(\d+)-/.exec(headerValue);
  return m ? Number(m[1]) : null;
}

// "M:SS / M:SS" → currentTime (left side) in seconds.
function leftSeconds(t: string): number {
  const left = t.split('/')[0]!.trim();
  const [m, s] = left.split(':').map((n) => Number(n));
  return (m ?? 0) * 60 + (s ?? 0);
}

test.describe('Journey: seek into un-decoded audio shows Buffering then resumes', () => {
  test('seek ahead → Buffering pill + cursor holds → release segment → resumes', async ({
    app,
    page,
  }) => {
    // ---- Arm the route hold BEFORE opening the project ----
    // A promise gate the test resolves to release the held segment. We capture
    // the held route so the release step can fulfill it from the test body.
    let releaseHeld: (() => void) | null = null;
    const heldGate = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    let heldRequestSeen = false;

    await page.route('**/api/audio/**', async (route: Route) => {
      const start = rangeStart(route.request().headers()['range'] ?? null);
      if (start != null && start >= HELD_SEGMENT_BYTE_THRESHOLD) {
        // This is the segment covering the seek target. Hold it until the test
        // releases the gate, then let the real request proceed so the segment
        // actually arrives and playback can resume.
        heldRequestSeen = true;
        await heldGate;
        await route.continue();
        return;
      }
      // Head probe + earlier segments: let them through untouched so the stem's
      // head decodes and playback can start.
      await route.continue();
    });

    await app.open();
    await app.openProjectNamed('Long sample project');

    // Transport ready: the long stem's head segment has decoded (duration is
    // non-zero — openProjectNamed waits on that) and the play button is enabled
    // and not in its loading state.
    const playBtn = page.getByRole('button', { name: 'Play' });
    await expect(playBtn).toBeEnabled();
    await expect(playBtn).not.toHaveAttribute('aria-disabled', 'true');

    const timeText = () => page.locator('.atb-time').innerText();

    // Start playback. The .play button gains the `on` class while playing
    // (aria-label stays "Play" by design — see AppToolbar.tsx / the
    // play-while-buffering journey).
    await page.keyboard.press('Space');
    await expect(playBtn).toHaveClass(/\bon\b/, { timeout: 5_000 });
    // Confirm it actually started advancing from the head before we seek.
    await expect
      .poll(async () => leftSeconds(await timeText()), { timeout: 8_000 })
      .toBeGreaterThanOrEqual(0);

    // ---- Seek ahead into the held (un-decoded) segment ----
    // Click the ruler at ~0.75 of its width → ~45s of the 60s clip, which lands
    // in seg2 (held). xToTime maps clientX across the ruler's full width to
    // [0, duration] (Player.tsx). The click seeks (a no-drag click on the ruler
    // always seeks — Player.tsx mouseup handler).
    const ruler = page.locator('.ruler');
    const box = await ruler.boundingBox();
    if (!box) throw new Error('ruler bounding box unavailable');
    const seekX = box.x + box.width * SEEK_FRACTION;
    const seekY = box.y + box.height / 2;
    await page.mouse.click(seekX, seekY);

    // ---- Assert the Buffering pill appears + cursor holds ----
    // The playhead reaches the undecoded region and stalls: usePlayer sets
    // buffering=true and freezes the cursor at the seek target; Player.tsx
    // renders the `audio-loading-pill` with text "Buffering…". (When `loading`
    // is set the pill instead says "Loading audio…" — but loading is already
    // cleared by HEADS_READY at this point, so the text is the buffering one.)
    await expect(page.locator('.audio-loading-pill-text')).toHaveText(
      /Buffering/,
      { timeout: 10_000 },
    );
    // The sr-only status node also carries "Buffering…".
    await expect(page.getByRole('status').filter({ hasText: 'Buffering…' })).toBeVisible();

    // Cursor holds: the frozen position sits at ~the seek target and does not
    // advance while buffering. Sample twice with a real gap; the displayed
    // second must not climb. (This is the inverse of the resume poll — here we
    // assert NON-advance, so a short fixed wait is correct: if the cursor were
    // running it would tick past the seek second within ~1s.)
    const held1 = leftSeconds(await timeText());
    expect(held1).toBeGreaterThanOrEqual(SEEK_SECONDS - 2);
    await page.waitForTimeout(1_200);
    const held2 = leftSeconds(await timeText());
    expect(
      held2,
      `cursor advanced while buffering (${held1}s → ${held2}s) — stall not holding`,
    ).toBeLessThanOrEqual(held1 + 1);

    // The held request must actually have been the seek-target segment — guards
    // against the test passing because nothing was ever held (e.g. byte math
    // drifted past the threshold).
    expect(heldRequestSeen, 'no held Range request observed for the seek target').toBe(true);

    // ---- Release the segment → playback resumes ----
    releaseHeld!();

    // Resume: once seg2 arrives + decodes, isPositionCovered(stallPos) flips
    // true, buffering clears, and sources reschedule from the seek target. The
    // pill disappears and the playhead advances PAST the seek point.
    await expect(page.locator('.audio-loading-pill')).toHaveCount(0, {
      timeout: 15_000,
    });
    // Poll the readout until the left-side seconds climb past the seek point.
    // Poll (not a fixed sub-second sample): .atb-time renders whole seconds, so
    // two reads close together can land in the same integer second while the
    // playhead genuinely advances — that exact pattern flaked in CI before
    // (see play-while-buffering.spec.ts). Polling is resolution-robust and
    // still fails on a real freeze (it times out).
    await expect
      .poll(async () => leftSeconds(await timeText()), { timeout: 15_000 })
      .toBeGreaterThan(SEEK_SECONDS);

    // Pause so teardown / the consoleIssues assertion doesn't race the rAF.
    await page.keyboard.press('Space');
    await expect(playBtn).not.toHaveClass(/\bon\b/, { timeout: 5_000 });

    // No bespoke console listener: the shared `consoleIssues` fixture throws at
    // end-of-test on any console.error / pageerror — decode/schedule/Range
    // failures surface there (segment-stream.ts throws `segment fetch <status>`
    // and `decodeSegment: no complete MP3 frame…`).
  });
});
