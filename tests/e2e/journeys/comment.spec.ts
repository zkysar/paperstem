import { expect, test } from '../helpers/fixtures.js';

test.describe('Journey: drop a comment at the playhead, see it in the drawer', () => {
  test('C → type body → Save → comment appears in list', async ({
    app,
    page,
  }) => {
    await app.open();
    await app.openSampleProject();

    // Pressing C in the global keyboard handler creates a point annotation
    // at the playhead and opens the comments drawer with a draft slot.
    // The drawer's draft textarea autoFocuses on mount.
    await page.keyboard.press('c');

    const drawer = page.getByRole('dialog', { name: 'All comments' });
    await expect(drawer).toBeVisible();

    const draft = drawer.getByPlaceholder('Write a note…');
    await draft.waitFor({ state: 'visible' });
    const body = 'e2e: this riff is the one';
    await draft.fill(body);

    // The Save button label is "Save (⌘↵)" on desktop, plain "Save" on
    // mobile — match either with a regex on the accessible name.
    const save = drawer.getByRole('button', { name: /^Save/ });
    await expect(save).toBeEnabled();
    await save.click();

    // The new card should land in the list. Anchor specifically on the
    // .cl-body div inside the card — `getByText` would also match the
    // card's <li> ancestor as a substring container, which is strict-mode
    // ambiguous.
    const cardBody = drawer.locator('.cl-body', { hasText: body });
    await expect(cardBody).toBeVisible();

    // Drawer count chip ("· N") should now read at least 1.
    const countText = await drawer.locator('.cd-count').innerText();
    const count = parseInt(countText.replace(/[^0-9]/g, ''), 10);
    expect(count).toBeGreaterThanOrEqual(1);

    // Layout invariant: opening a side drawer changes the grid column
    // layout, which is the exact class of change that can re-trigger the
    // PR #133 feedback loop on resize. Verify widths stayed bounded.
    await app.expectLayoutBounded();
  });
});
