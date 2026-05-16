# E2E (Playwright)

These tests drive a real Chromium against a real `npm run dev` server.

- **Run:** `npm run test:e2e` (or `npm run test:e2e:headed` to watch).
- **Debug a flake:** `npx playwright test --trace on tests/e2e/journeys/<name>.spec.ts` then `npx playwright show-report`.
- **Add a new journey:** copy the smallest existing spec, replace the journey body, lean on the `app` fixture in `helpers/fixtures.ts` (`app.open`, `app.openSampleProject`, `app.expectLayoutBounded`, `app.expectNoLongTask`).

Full conventions — what e2e is for, when to add a journey, how the dev-server fixture works — are in [docs/testing.md § End-to-end tests](../../docs/testing.md#end-to-end-tests-playwright). Read that before adding new tests.
