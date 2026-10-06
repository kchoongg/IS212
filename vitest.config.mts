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
    setupFiles: ["./src/test/setup.ts"],
    // src/lib/auth.ts refuses to load without one. Test-only value.
    env: { JWT_SECRET: "test-secret" },
    coverage: {
      provider: "v8",
      // Every source file counts, including ones no test imports - otherwise
      // an untested file is simply missing from the report instead of at 0%.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts", "src/**/__mocks__/**", "src/test/**"],
      // text: the table in the terminal / CI log. html: coverage/index.html.
      reporter: ["text", "html"],
      // `npm run test:coverage` (and so the CI "Unit tests" check) fails below
      // these. Set a little under the real figures (99% statements, 97%
      // branches on 2026-10-02) so a refactor does not trip them, but a new
      // page or route with no tests does. Plain `npm test` does not check them.
      thresholds: { statements: 95, branches: 92, functions: 95, lines: 95 },
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
