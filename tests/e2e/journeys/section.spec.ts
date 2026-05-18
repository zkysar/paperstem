import { expect, test } from '../helpers/fixtures.js';

test.describe('Journey: create a labelled section marker at the playhead', () => {
  test('M → switch to Label mode → type label → Add section → pill appears', async ({
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
    // "Label" mode, which does not touch the band's song catalog. The
    // Song/Label control is a pill toggle (radiogroup), not tabs.
    await popover.getByRole('radio', { name: 'Label' }).click();

    const label = 'e2e: warm-up';
    await popover.getByLabel('Label').fill(label);

    // Enter inside the input submits.
    await popover.getByLabel('Label').press('Enter');

    // The popover closes once the submit promise resolves.
    await expect(popover).toBeHidden();

    // The section lane renders the new section as either a `.section-pill`
    // (expanded view, shown when activeSectionId is set) or a
    // `.section-ribbon-seg` (collapsed). Both expose the label via
    // `aria-label`; that's the most stable signal regardless of which
    // view the lane settled into. We assert on aria-label rather than
    // visible text because the collapsed ribbon doesn't render the label
    // as a text node.
    const sectionEl = page.locator(`.section-pill[aria-label="${label}"], .section-ribbon-seg[aria-label="${label}"]`);
    await expect(sectionEl).toBeVisible({ timeout: 5_000 });

    // Layout invariant — the section lane expands the timeline and is the
    // other major contributor to layout churn besides the zoom path.
    await app.expectLayoutBounded();
  });
});
