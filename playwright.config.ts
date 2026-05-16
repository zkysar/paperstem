import { defineConfig, devices } from '@playwright/test';

// The dev launcher (bin/dev.ts) picks random ports each run, so we can't set
// a static baseURL here. Instead, globalSetup writes the URL into a state
// file that the `app` fixture in tests/e2e/helpers/fixtures.ts reads at
// test time. See tests/e2e/global-setup.ts.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  // Each journey runs end-to-end against a freshly seeded server. Parallelism
  // would race over the same dev DB, so we serialise. The suite is small
  // enough (<10 specs) that this is still fast.
  fullyParallel: false,
  workers: 1,
  // 90s overall per test — generous for cold Vite startup on CI.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Test code reads PAPERSTEM_E2E_BASE_URL from a state file via the
    // `app` fixture instead of relying on use.baseURL, which is captured
    // before globalSetup runs.
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Most journeys are wide-layout — narrow uses a different code path
        // (CommentBottomSheet, MobileZoomPopover) that's not the focus of
        // the first wave of e2e coverage.
        viewport: { width: 1280, height: 800 },
        // Lets the player start playback without a synthesized user gesture
        // in cases where the test exercises Space-to-play.
        launchOptions: {
          args: ['--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
  ],
});
