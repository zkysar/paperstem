import { expect, test } from '../helpers/fixtures.js';

test.describe('Journey: create a labelled section marker at the playhead', () => {
  test('M → switch to Label tab → type label → Add section → pill appears', async ({
    app,
    page,
  }) => {
    await app.open();
    await app.openSampleProject();

    // M opens the section popover anchored at the playhead. (Shift+M
    // drops the implicit "end" marker without a prompt — different path.)
    await page.keyboard.press('m');

    const popover = page.getByRole('dialog', { name: /Create section/ });
    await expect(popover).toBeVisible();

    // The popover starts in 'song' mode where free text is treated as a
    // catalog-song name. For an e2e label we want the lighter-weight
    // "Label" tab, which does not touch the band's song catalog.
    await popover.getByRole('tab', { name: 'Label' }).click();

    const label = 'e2e: warm-up';
    await popover.getByLabel('Label').fill(label);

    // Enter inside the input submits.
    await popover.getByLabel('Label').press('Enter');

    // The popover closes once the submit promise resolves.
    await expect(popover).toBeHidden();

    // A new section pill should show up in the section lane. The label
    // text also appears in ActiveSectionChip (above the ruler) and inside
    // the section-pill button's enclosing text — getByText would match
    // all three and fail strict mode. Anchor specifically on the lane's
    // .section-pill-label span.
    const pillLabel = page.locator('.section-pill-label', { hasText: label });
    await expect(pillLabel).toBeVisible({ timeout: 5_000 });

    // Layout invariant — the section lane expands the timeline and is the
    // other major contributor to layout churn besides the zoom path.
    await app.expectLayoutBounded();
  });
});
