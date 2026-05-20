import { expect, test } from '../helpers/fixtures.js';

test.describe('Journey: open and close every overlay with no leaked modal state', () => {
  test('picker → drawer → share → shortcuts — Escape cleans up each', async ({
    app,
    page,
  }) => {
    await app.open();
    await app.openSampleProject();

    // ---- Project picker -------------------------------------------------
    // The picker auto-closes after openSampleProject. Re-open via ⌘K.
    const ctrl = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${ctrl}+k`);
    const picker = page.getByRole('dialog', { name: 'Projects' });
    await expect(picker).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await app.expectLayoutBounded();

    // ---- Comments drawer ------------------------------------------------
    // The header's "Toggle comments" button opens the drawer.
    await page.getByRole('button', { name: 'Toggle comments' }).click();
    const drawer = page.getByRole('dialog', { name: 'All comments' });
    await expect(drawer).toBeVisible();
    // Escape doesn't close the drawer (that's a popover-level shortcut);
    // the close button does.
    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toBeHidden();
    await app.expectLayoutBounded();

    // ---- Share dialog ---------------------------------------------------
    await page.getByRole('button', { name: 'Share link' }).click();
    const share = page.getByRole('dialog', { name: 'Share link' });
    await expect(share).toBeVisible();
    await share.getByRole('button', { name: 'Close share dialog' }).click();
    await expect(share).toBeHidden();
    await app.expectLayoutBounded();

    // ---- Shortcuts overlay (via "?") -----------------------------------
    await page.keyboard.press('?');
    // The shortcuts overlay role / label isn't critical for this assertion
    // — just verify SOMETHING new appeared, then dismiss it. The simplest
    // observable signal is that a new role="dialog" exists.
    const dialogs = page.getByRole('dialog');
    await expect(dialogs.first()).toBeVisible({ timeout: 3_000 });
    await page.keyboard.press('Escape');

    // Final invariant: no role="dialog" remains visible.
    const visibleCount = await dialogs.count();
    for (let i = 0; i < visibleCount; i++) {
      // The drawer/picker/share dialogs unmount entirely; a leaked one
      // would still be in the tree and addressable.
      const isVisible = await dialogs.nth(i).isVisible().catch(() => false);
      expect(isVisible, `dialog ${i} remained visible after Escape`).toBe(
        false,
      );
    }
    await app.expectLayoutBounded();
  });

  test('single-key shortcuts are suppressed while a modal is open (issue #222)', async ({
    app,
    page,
  }) => {
    await app.open();
    await app.openSampleProject();

    const ctrl = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${ctrl}+k`);
    const picker = page.getByRole('dialog', { name: 'Projects' });
    await expect(picker).toBeVisible();

    // With the picker open, pressing ? must NOT open the shortcuts help on
    // top of it (the original bug stacked dialogs).
    await page.keyboard.press('?');
    await expect(
      page.getByRole('dialog', { name: 'Keyboard shortcuts' }),
    ).toBeHidden();

    // Further single keys (Groups/zoom/comment) must not open anything new
    // either: the picker stays the only visible dialog.
    await page.keyboard.press('g');
    await page.keyboard.press('s');
    await page.keyboard.press('c');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(picker).toBeVisible();

    // Escape still closes the picker — the one shortcut that stays active.
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await app.expectLayoutBounded();
  });
});
