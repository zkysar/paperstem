import { expect, test } from '../helpers/fixtures.js';

// The sample-seeded project has three stems; we rely on that count for the
// drag span. If the seed grows, this number needs to update.
const TRACK_COUNT = 3;

test.describe('Journey: drag-paint mute and solo across tracks', () => {
  test('press-and-drag on the M pill mutes every track the cursor crosses', async ({
    app,
    page,
  }) => {
    await app.open();
    await app.openSampleProject();

    // All three tracks render with their data-track-idx attribute. Wait for
    // them, then collect bounding boxes so we can drive the mouse through
    // each row centre.
    const rows = page.locator('[data-track-idx]');
    await expect(rows).toHaveCount(TRACK_COUNT);

    const rowBoxes = await Promise.all(
      Array.from({ length: TRACK_COUNT }, (_, i) =>
        rows.nth(i).boundingBox().then((b) => {
          if (!b) throw new Error(`row ${i} has no bounding box`);
          return b;
        }),
      ),
    );

    const muteBtn = (idx: number) =>
      rows.nth(idx).locator('.pill.mute');

    const soloBtn = (idx: number) =>
      rows.nth(idx).locator('.pill.solo');

    // Pre-condition: every track is unmuted.
    for (let i = 0; i < TRACK_COUNT; i++) {
      await expect(muteBtn(i)).not.toHaveClass(/\bon\b/);
    }

    // Press on track 0's M pill, drag downward through tracks 1 and 2, release.
    const m0 = muteBtn(0);
    const m0Box = await m0.boundingBox();
    if (!m0Box) throw new Error('mute pill 0 has no bounding box');
    await page.mouse.move(m0Box.x + m0Box.width / 2, m0Box.y + m0Box.height / 2);
    await page.mouse.down();
    // Move through the centre of each subsequent row.
    for (let i = 1; i < TRACK_COUNT; i++) {
      const b = rowBoxes[i];
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    }
    await page.mouse.up();

    // After the gesture, every M pill should be on.
    for (let i = 0; i < TRACK_COUNT; i++) {
      await expect(muteBtn(i)).toHaveClass(/\bon\b/);
    }

    // body class should be removed after mouseup.
    await expect(page.locator('body')).not.toHaveClass(/dragging-vertical/);

    // Now drag again starting on the (already muted) track 0 — the brush
    // becomes "unmute" and should unmute every row crossed.
    const m0_2 = muteBtn(0);
    const m0Box2 = await m0_2.boundingBox();
    if (!m0Box2) throw new Error('mute pill 0 (second pass) has no bounding box');
    await page.mouse.move(
      m0Box2.x + m0Box2.width / 2,
      m0Box2.y + m0Box2.height / 2,
    );
    await page.mouse.down();
    for (let i = 1; i < TRACK_COUNT; i++) {
      const b = rowBoxes[i];
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    }
    await page.mouse.up();

    for (let i = 0; i < TRACK_COUNT; i++) {
      await expect(muteBtn(i)).not.toHaveClass(/\bon\b/);
    }

    // Solo runs through the same code path. Smoke-check it: drag from track
    // 0's S pill across to track 1.
    const s0 = soloBtn(0);
    const s0Box = await s0.boundingBox();
    if (!s0Box) throw new Error('solo pill 0 has no bounding box');
    await page.mouse.move(s0Box.x + s0Box.width / 2, s0Box.y + s0Box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      rowBoxes[1].x + rowBoxes[1].width / 2,
      rowBoxes[1].y + rowBoxes[1].height / 2,
    );
    await page.mouse.up();

    await expect(soloBtn(0)).toHaveClass(/\bon\b/);
    await expect(soloBtn(1)).toHaveClass(/\bon\b/);
    await expect(soloBtn(2)).not.toHaveClass(/\bon\b/);

    await app.expectLayoutBounded();
  });
});
