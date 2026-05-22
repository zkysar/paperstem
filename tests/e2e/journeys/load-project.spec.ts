import { expect, test } from '../helpers/fixtures.js';

test.describe('Journey: load a seeded project and scrub the playhead', () => {
  test('dev auto-login → pick project → stems load → scrub via ruler click', async ({
    app,
    page,
  }) => {
    // Dev auto-login is wired through useSession's null-user→devLoginUrl retry;
    // by the time `open()` resolves the user is authenticated and the
    // ProjectPicker is open with no project active. Asserting the picker is
    // visible doubles as a sanity check for the auth path.
    await app.open();

    await app.openSampleProject();

    // Toolbar should now expose enabled playback controls.
    const play = page.getByRole('button', { name: 'Play' });
    await expect(play).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Restart' })).toBeEnabled();

    // Layout invariant after the project has loaded.
    await app.expectLayoutBounded();

    // Scrub: click partway through the ruler. The ruler handles
    // pointerdown to seek the player to the clicked x position. We use
    // the bounding box so the click translates to a meaningful time
    // regardless of viewport width.
    const ruler = page.locator('.ruler');
    const box = await ruler.boundingBox();
    expect(box).not.toBeNull();
    await ruler.click({
      // Click ~25% of the way across. The ruler is wider than the
      // visible waveform (it spans into the rail spacer column), but a
      // simple percentage of the ruler width still produces a stable
      // mid-song seek.
      position: { x: Math.round(box!.width * 0.25), y: box!.height / 2 },
    });

    // The time readout should now show a non-zero current time. The
    // exact value depends on the seeded MP3 length, so we just match
    // "not 0:00 /".
    await expect
      .poll(async () => await page.locator('.atb-time').innerText(), {
        timeout: 5_000,
      })
      .not.toMatch(/^0:00\s/);

    // Now press the toolbar's Restart button to verify the playhead
    // round-trips back to 0.
    await page.getByRole('button', { name: 'Restart' }).click();
    await expect
      .poll(async () => await page.locator('.atb-time').innerText(), {
        timeout: 5_000,
      })
      .toMatch(/^0:00\s/);

    // Final layout check — seeking and scrubbing shouldn't have perturbed
    // anything visible.
    await app.expectLayoutBounded();
  });
});
