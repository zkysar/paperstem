import { expect, test } from '../helpers/fixtures.js';

test.describe('Journey: arm a loop, drag a region, play through it', () => {
  // Looping is the only flow that runs the player rAF tick continuously
  // against a region boundary. If anything in the playback loop allocates
  // or re-renders on every tick, this is where it shows up as a Long
  // Task. We arm the loop, drag a small region from ~30% to ~50% of the
  // ruler, press Space, and assert no >100ms blocking tasks during the
  // first second of loop playback.
  test('arm loop → drag region on ruler → Space → no long tasks', async ({
    app,
    page,
  }) => {
    await app.open();
    await app.openSampleProject();

    // Arm the loop. The button starts in "Loop" state; first click flips
    // loopArmed so the next ruler drag creates the region.
    const loopBtn = page.getByRole('button', { name: 'Toggle loop' });
    await loopBtn.click();
    await expect(loopBtn).toHaveClass(/loop-on/);

    // Drag a region across the middle of the ruler. We use the ruler's
    // bounding box so the drag works regardless of viewport width.
    const ruler = page.locator('.ruler');
    const box = await ruler.boundingBox();
    expect(box).not.toBeNull();
    const y = box!.y + box!.height / 2;
    const x1 = box!.x + box!.width * 0.3;
    const x2 = box!.x + box!.width * 0.5;

    // Playwright's mouse.* primitives fire real pointer events through
    // the synthetic input pipeline, matching what onRulerPointerDown
    // listens for. A handful of intermediate moves keeps the drag from
    // being mistaken for a click.
    await page.mouse.move(x1, y);
    await page.mouse.down();
    await page.mouse.move((x1 + x2) / 2, y, { steps: 5 });
    await page.mouse.move(x2, y, { steps: 5 });
    await page.mouse.up();

    // The loop region overlay should now be visible. (The class flips to
    // `.loop-region.disabled` when the toggle is off — we don't expect
    // disabled here because the freshly-created region auto-enables.)
    const loopRegion = page.locator('.loop-region').first();
    await expect(loopRegion).toBeVisible({ timeout: 3_000 });
    await expect(loopRegion).not.toHaveClass(/\bdisabled\b/);

    // Layout invariant — loop region overlays inside .viewport-inner
    // and shouldn't perturb widths.
    await app.expectLayoutBounded();

    // Play through the loop. We don't need actual audio output — the
    // player's rAF tick still runs, currentTime advances, and the loop
    // wrap-around logic fires at the boundary. Long-task observer
    // catches anything blocking >100ms during the playback window.
    await app.expectNoLongTask(
      'first second of loop playback',
      async () => {
        await page.keyboard.press('Space');
        // ~1.2s — long enough that a typical loop region (5–15s of song)
        // ticks several times but doesn't itself wrap. We're catching
        // per-tick jank, not wrap-around behaviour.
        await page.waitForTimeout(1200);
        // Pause so subsequent assertions don't race the rAF.
        await page.keyboard.press('Space');
      },
    );

    // Escape clears the loop (per useKeyboard.ts L153). After clearing,
    // the region should unmount.
    await page.keyboard.press('Escape');
    await expect(loopRegion).toBeHidden({ timeout: 2_000 });
    await app.expectLayoutBounded();
  });
});
