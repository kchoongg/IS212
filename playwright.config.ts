import { defineConfig, devices } from "@playwright/test";

// End-to-end smoke tests: the real app, built and started, driven through a
// real browser, against a real Postgres database - no test doubles. A few
// critical journeys only; everything else is the unit tests' job.
//
//   npm run test:e2e        (needs DATABASE_URL to a migrated, seeded database)
//   npm run test:e2e:ui     (Playwright's step-by-step viewer)
//
// CI runs them on every pull request against its own throwaway Postgres.
// The tests create events and change their status, so they must never run
// against the team's shared Neon database: this refuses any database that is
// not on this machine.

const PORT = 3100;
const databaseUrl = process.env.DATABASE_URL ?? "";
const host = (() => {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1"].includes(host)) {
  throw new Error(
    `End-to-end tests change data, so they only run against a local database. DATABASE_URL points at "${host || "nothing"}". ` +
      "Start a local Postgres, migrate and seed it, and set DATABASE_URL to it."
  );
}

export default defineConfig({
  testDir: "e2e",
  // One database, shared by every test: run them one at a time so no test
  // sees another's half-finished changes.
  workers: 1,
  fullyParallel: false,
  // No automatic retries: a test that only passes on a second try is flaky,
  // and a retry would hide that rather than fix it.
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // The browser's clock is Singapore's, as for every real user: all venues
    // are in Singapore and the app works in Singapore time (discussion #36).
    // Without it the browser takes the machine's zone - UTC on CI - so an
    // event entered as 09:00-17:00 became 17:00-01:00 Singapore time.
    timezoneId: "Asia/Singapore",
    // What to look at when a test fails: a replayable trace of every step,
    // and a screenshot of the page as it was.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // The production build, as users get it - not the dev server.
  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
