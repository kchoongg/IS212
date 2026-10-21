import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Server-side tests run in plain Node. A UI test (*.test.tsx) opts into a
    // browser-like DOM with `// @vitest-environment jsdom` on its first line.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // Archived tests are a record of behaviour that changed on purpose, never
    // run (docs/test-cases/DECOMMISSIONED.md). Outside src/ already; listed so
    // a wider include can never pick them up.
    exclude: ["**/node_modules/**", "tests/archive/**"],
    setupFiles: ["./src/test/setup.ts"],
    // How long one test may run. A UI test's findBy*/waitFor may each wait up
    // to 5 seconds (asyncUtilTimeout, src/test/setup.ts), which is also
    // Vitest's default for a whole test - so on a loaded CI runner a page test
    // that renders and then waits once was cut off at 5000ms with nothing
    // wrong (SPM-90's "keeps the session with the space", 2026-10-21). Longer
    // than any single wait, so a real failure still reports its own message.
    testTimeout: 15_000,
    // src/lib/auth.ts refuses to load without one. Test-only value.
    env: { JWT_SECRET: "test-secret" },
    coverage: {
      provider: "v8",
      // Every source file counts, including ones no test imports - otherwise
      // an untested file is simply missing from the report instead of at 0%.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts", "src/**/__mocks__/**", "src/test/**"],
      // text: the table in the terminal / CI log. html: coverage/index.html.
      // json: coverage/coverage-final.json, which `npm run coverage:changed`
      // reads to find changed lines that no test runs.
      reporter: ["text", "html", "json"],
      // `npm run test:coverage` (and so the CI "Unit tests" check) fails below
      // these. Set a little under the real figures (99.7% statements, 99.1%
      // branches, 99.9% functions and lines on 2026-10-15) so a refactor does
      // not trip them, but a new page or route with no tests does. What is
      // still uncovered is code no test can reach: defensive guards, and
      // fallbacks for values the server always sends. Plain `npm test` does
      // not check them.
      thresholds: { statements: 99, branches: 98.5, functions: 99, lines: 99 },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
      // The real module needs the App Router mounted; tests get spies instead.
      "next/navigation": path.resolve(dirname, "./src/test/navigation.ts"),
    },
  },
});
