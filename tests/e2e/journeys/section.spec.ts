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

    // A new section pill should show up in the section lane (or the
    // collapsed ribbon, depending on layout density). Either lane shows
    // the label text once the section is materialised.
    await expect(page.getByText(label)).toBeVisible({ timeout: 5_000 });

    // Layout invariant — the section lane expands the timeline and is the
    // other major contributor to layout churn besides the zoom path.
    await app.expectLayoutBounded();
  });
});
