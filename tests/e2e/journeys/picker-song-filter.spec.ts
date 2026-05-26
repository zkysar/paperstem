import { expect, test } from '../helpers/fixtures.js';

// Regression guard for the project picker's "Filter by song" facet bar.
// Before the single-row treatment the bar used `flex-wrap: wrap`, so on a
// phone even a handful of song chips spilled onto 2–3 rows and pushed the
// project list below the fold. The fix pins the label and puts the chips in a
// non-wrapping row that scrolls sideways. happy-dom can't verify either part
// (no layout, no scroll), so this lives in e2e.
test.describe('Journey: project picker song-filter bar stays one scrolling row', () => {
  test('song chips overflow horizontally without growing the bar (phone width)', async ({
    app,
    page,
  }) => {
    // The bug only manifests when the chips are wider than the picker, which
    // is the common case on a phone. Size down before opening so the picker
    // renders at its mobile width.
    await page.setViewportSize({ width: 390, height: 800 });
    await app.open(); // picker auto-opens (no project selected)

    const picker = page.getByRole('dialog', { name: 'Projects' });
    await expect(picker).toBeVisible();

    // The seeded band has a song catalog, so the facet bar renders with chips.
    const bar = picker.locator('.fp-song-bar');
    const scroll = picker.locator('.fp-song-scroll');
    await expect(bar).toBeVisible();
    await expect(scroll).toBeVisible();
    const chipCount = await scroll.locator('.fp-song-chip').count();
    expect(chipCount).toBeGreaterThan(1);

    // The chips are wider than the row: in the old wrapping design this is
    // exactly the condition that spilled them onto extra rows. With the
    // single-row treatment the overflow is horizontal (scrollable) instead.
    const { scrollWidth, clientWidth } = await scroll.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth).toBeGreaterThan(clientWidth);

    // ...and despite that overflow the bar stays a single row. Compare its
    // height to one chip's height: a wrapped 2–3 row bar would be well over
    // one chip-row plus padding.
    const chipBox = await scroll.locator('.fp-song-chip').first().boundingBox();
    const barBox = await bar.boundingBox();
    expect(chipBox).not.toBeNull();
    expect(barBox).not.toBeNull();
    expect(barBox!.height).toBeLessThan(chipBox!.height + 28);

    // The track genuinely scrolls — it isn't just clipping the overflow.
    const before = await scroll.evaluate((el) => el.scrollLeft);
    await scroll.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect
      .poll(async () => scroll.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(before);
  });
});
