import { expect, test } from '../helpers/fixtures.js';

test.describe('Journey: zoom in, scroll, zoom out — layout stays bounded', () => {
  // This is the regression class that froze the tab in May 2026 (PR #133,
  // commit ffc23e0). A single W press caused .viewport-inner's pixel width
  // to feed back into the outer grid column, which fed back into .stage's
  // measured width, which fed back into innerWidth. We catch it by
  // measuring after every zoom step and refusing to let any width grow
  // beyond MAX_HZOOM × 2 of the viewport.
  test('press W several times, then S, then ⌘0 — widths stay bounded', async ({
    app,
    page,
  }) => {
    await app.open();
    await app.openSampleProject();

    // Snapshot baseline widths so we can compare zoom-1 ↔ zoom-N afterwards.
    const baseline = await readWidths(page);
    expect(baseline.stage).toBeGreaterThan(0);
    expect(baseline.viewportInner).toBeGreaterThan(0);

    // Five W presses ≈ 1.5^5 = 7.6× zoom. The runaway bug overshoots into
    // the millions of pixels within 8 keystrokes; if the loop is alive,
    // expectLayoutBounded fails *long* before we run out of presses.
    for (let i = 0; i < 5; i++) {
      await app.expectNoLongTask(`zoom step ${i + 1}`, async () => {
        await page.keyboard.press('w');
        // Let the React commit flush + ResizeObserver settle before we
        // measure. expect.poll on a stable hZoom readout is the most
        // observable signal; the readout updates every commit.
        await page.waitForTimeout(50);
      });
      await app.expectLayoutBounded();
    }

    // After several W presses, the toolbar's zoom readout should reflect
    // a value greater than 100%.
    const readoutAfterIn = await page.locator('.toolbar-readout').innerText();
    const pctIn = parseInt(readoutAfterIn.replace('%', ''), 10);
    expect(pctIn).toBeGreaterThan(100);

    // Pan with A/D — also touches scrollLeft, another input to the layout
    // graph the bug followed.
    await app.expectNoLongTask('pan left', async () => {
      await page.keyboard.press('d');
      await page.keyboard.press('d');
      await page.waitForTimeout(50);
    });
    await app.expectLayoutBounded();

    // Zoom back out. S is the symmetric counterpart of W.
    for (let i = 0; i < 7; i++) {
      await app.expectNoLongTask(`zoom-out step ${i + 1}`, async () => {
        await page.keyboard.press('s');
        await page.waitForTimeout(50);
      });
      await app.expectLayoutBounded();
    }

    // ⌘0 / Ctrl+0 — fit-to-window. After this the readout returns to 100%.
    const ctrl = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${ctrl}+0`);
    await expect
      .poll(async () => await page.locator('.toolbar-readout').innerText(), {
        timeout: 3_000,
      })
      .toBe('100%');

    // Final check: widths should be back within a hair of baseline.
    const after = await readWidths(page);
    expect(Math.abs(after.stage - baseline.stage)).toBeLessThan(8);
  });
});

async function readWidths(page: import('@playwright/test').Page): Promise<{
  stage: number;
  viewportInner: number;
  ruler: number;
}> {
  return page.evaluate(() => {
    const w = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return el ? el.getBoundingClientRect().width : 0;
    };
    return {
      stage: w('.stage'),
      viewportInner: w('.viewport-inner'),
      ruler: w('.ruler'),
    };
  });
}
