import { expect, test } from '../helpers/fixtures.js';

// Smoke guard for the head-start streaming feature: an MP3 stem plays from a
// decoded head segment immediately while the remaining segments fill in the
// background. The interesting timing (a multi-MB stem audible before the whole
// file downloads) can't be demonstrated against the dev seed — its three MP3
// stems are tiny (~5s, ~40KB), so there's effectively no buffering gap to
// observe. What this journey *can* lock down is the part unit tests can't see:
// in a real Chromium, with a real AudioContext and real Range-backed segment
// fetches, the seeded project opens, Space starts playback, the playhead
// advances monotonically, and the decode/schedule/Range path throws nothing.
//
// The decode/schedule path surfaces failures as thrown errors
// (segment-stream.ts: `segment fetch <status>`, `decodeSegment: no complete
// MP3 frame…`) — those bubble up as console.error / pageerror, which the
// shared `consoleIssues` fixture already asserts empty at the end of every
// test. So "no decode/schedule/Range errors" needs no bespoke listener here;
// using the wrapped `test` export is the assertion.
test.describe('Journey: play a seeded project while it buffers in the background', () => {
  test('open project → play → playhead advances → no decode/schedule errors', async ({
    app,
    page,
  }) => {
    await app.open();
    await app.openSampleProject();

    // The waveform/timeline has rendered (openSampleProject waits on .stage +
    // a non-zero duration in the time readout). Confirm the transport is ready
    // before we touch it.
    const playBtn = page.getByRole('button', { name: 'Play' });
    await expect(playBtn).toBeEnabled();
    // While the head segment is still decoding the button carries is-loading /
    // aria-disabled; wait for that to clear so the Space press actually starts
    // playback rather than flashing the loading indicator (AppToolbar.tsx).
    await expect(playBtn).not.toHaveAttribute('aria-disabled', 'true');

    // Capture the starting time. The readout is "currentTime / duration"
    // (.atb-time); it should sit at 0:00 before we press play.
    const timeText = () => page.locator('.atb-time').innerText();
    const seconds = (t: string): number => {
      // "M:SS / M:SS" → currentTime in seconds. Parse only the left side.
      const left = t.split('/')[0]!.trim();
      const [m, s] = left.split(':').map((n) => Number(n));
      return (m ?? 0) * 60 + (s ?? 0);
    };
    await expect.poll(timeText, { timeout: 5_000 }).toMatch(/^0:00\s/);

    // Press Space to play. The play button flips to its "on" state (the icon
    // swaps to Pause and the .play button gains the `on` class — aria-label
    // stays "Play" by design, so we assert on the class which tracks
    // isPlaying). See AppToolbar.tsx.
    await page.keyboard.press('Space');
    await expect(playBtn).toHaveClass(/\bon\b/, { timeout: 5_000 });

    // The playhead/currentTime should advance from ~0. The rAF tick in
    // usePlayer.ts writes setCurrentTime every frame while playing, which
    // renders into .atb-time — the same timeupdate signal load-project.spec.ts
    // polls. Assert it climbs above zero within a short window. We deliberately
    // don't assert a specific timecode: the seeded stems are ~5s, so a precise
    // target would be brittle (and a longer assert could hit end-of-song,
    // which resets currentTime to 0 — usePlayer.ts L590).
    await expect
      .poll(async () => seconds(await timeText()), { timeout: 8_000 })
      .toBeGreaterThan(0);

    // Monotonic advance: poll until the displayed second exceeds t1. A fixed
    // sub-second window (sample / waitForTimeout / sample) is NOT safe here —
    // .atb-time renders whole seconds, so two reads ~700ms apart can land in
    // the same integer second while the playhead genuinely advances (this raced
    // and failed in CI: "2s → 2s"). Polling is resolution-robust and still
    // fails on a real freeze (it times out). t1 ≈ 1s at this point (the poll
    // above resolves the moment the readout ticks to 0:01), so reaching t1 + 1
    // lands ~2s in — well before the ~5s clip's end-of-song reset.
    const t1 = seconds(await timeText());
    await expect
      .poll(async () => seconds(await timeText()), { timeout: 6_000 })
      .toBeGreaterThan(t1);

    // Pause so later teardown / consoleIssues assertion doesn't race the rAF.
    await page.keyboard.press('Space');
    await expect(playBtn).not.toHaveClass(/\bon\b/, { timeout: 5_000 });

    // Layout invariant — starting playback shouldn't perturb the stage/ruler
    // widths (cheap guard, consistent with the other playback journeys).
    await app.expectLayoutBounded();

    // No explicit consoleIssues assertion needed: the shared fixture throws at
    // end-of-test if any console.error / pageerror / unhandledrejection fired,
    // which is precisely the decode/schedule/Range-failure guard this journey
    // is meant to provide.
  });
});
