import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures.js';

const USER_B_EMAIL = 'e2e-b@paperstem.local';

async function devLogin(page: Page, baseURL: string, email?: string): Promise<void> {
  const url = email
    ? `${baseURL}/api/auth/dev-login?email=${encodeURIComponent(email)}`
    : `${baseURL}/api/auth/dev-login`;
  await page.goto(url);
  // dev-login redirects to /, which serves index.html via Vite.
  // Wait until the SPA shell indicates auth is resolved (ProjectPicker visible).
  await page
    .getByRole('dialog', { name: 'Projects' })
    .waitFor({ state: 'visible', timeout: 30_000 });
}

async function openProject(page: Page): Promise<void> {
  const row = page.getByRole('button', { name: /^Sample project/ });
  await row.first().click();
  await page.locator('.stage').waitFor({ state: 'visible' });
  await expect
    .poll(
      async () => {
        const text = await page.locator('.atb-time').innerText();
        return /\/\s+(?!0:00)\d+:\d{2}/.test(text);
      },
      { timeout: 30_000 },
    )
    .toBeTruthy();
}

test.describe('Journey: presence avatars appear between members and flip to idle', () => {
  test('two members open the same project — each sees the other, idle on hide', async ({
    baseURL,
    page: pageA,
  }) => {
    // Context A: the primary dev-seeded user (e2e@paperstem.local).
    await devLogin(pageA, baseURL);

    // Fetch the seeded band so we can invite user B into it.
    const bandsRes = await pageA.request.get(`${baseURL}/api/bands`);
    expect(bandsRes.ok()).toBeTruthy();
    const { bands } = await bandsRes.json() as { bands: { id: string }[] };
    expect(bands.length).toBeGreaterThan(0);
    const bandId = bands[0]!.id;

    // Invite user B into the band (creates the user row + membership row;
    // mail delivery will fail gracefully because GMAIL creds are placeholders
    // in the e2e env — that's fine, the membership still lands).
    const inviteRes = await pageA.request.post(
      `${baseURL}/api/bands/${bandId}/members`,
      { data: { email: USER_B_EMAIL } },
    );
    // 201 = invited, 409 = already_member from a previous run — both are fine.
    expect([201, 409]).toContain(inviteRes.status());

    // Open Sample project in context A.
    await openProject(pageA);

    // Spin up a second browser context for user B. We cannot reuse the
    // `browser` fixture here (it's bound to a single context), so we launch
    // our own Chromium instance. We use the same viewport as the main project.
    const browser = await chromium.launch();
    let ctxB: BrowserContext | undefined;
    let pageB: Page | undefined;
    try {
      ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      pageB = await ctxB.newPage();

      // User B logs in. The ?email= override is only honoured when
      // PAPERSTEM_DEV_AUTO_LOGIN is set (i.e. dev mode is on), which is
      // always true in the e2e env (global-setup sets the env var).
      await devLogin(pageB, baseURL, USER_B_EMAIL);

      // Open the same project in context B.
      await openProject(pageB);

      // Both contexts are now in the project with an active WS presence beat.
      // Assert A sees B's avatar (and vice-versa).
      await expect
        .poll(
          async () => {
            const count = await pageA
              .locator('[data-testid="presence-avatar"]')
              .count();
            return count;
          },
          { timeout: 15_000, message: 'context A should show at least 1 presence avatar (user B)' },
        )
        .toBeGreaterThanOrEqual(1);

      await expect
        .poll(
          async () => {
            const count = await pageB
              .locator('[data-testid="presence-avatar"]')
              .count();
            return count;
          },
          { timeout: 15_000, message: 'context B should show at least 1 presence avatar (user A)' },
        )
        .toBeGreaterThanOrEqual(1);

      // Trigger visibility-hidden on context A's page. The presence client
      // sends an idle beat when the tab goes hidden.
      await pageA.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get() { return 'hidden'; },
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      // Context B should eventually show user A's avatar with .presence-avatar-idle.
      await expect
        .poll(
          async () => {
            const idleCount = await pageB
              .locator('[data-testid="presence-avatar"].presence-avatar-idle')
              .count();
            return idleCount;
          },
          { timeout: 15_000, message: 'context B should show at least 1 idle avatar after A goes hidden' },
        )
        .toBeGreaterThanOrEqual(1);
    } finally {
      await ctxB?.close();
      await browser.close();
    }
  });
});
