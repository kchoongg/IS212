import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Integration tests (integration/): the route handlers and the real Prisma
// client against a real Postgres - no vi.mock("@/lib/prisma"). They prove what
// the unit tests cannot: that the rules hold once rows, transactions and row
// locks are real (e.g. two booking requests at the same moment).
//
//   npm run test:integration   (needs DATABASE_URL to a migrated, seeded database)
//
// CI runs them on every pull request against its own throwaway Postgres.
// Each test creates the rows it needs and deletes them afterwards, but they
// still write, so - like the end-to-end tests - they refuse any database that
// is not on this machine. The team's shared Neon database is never touched.

const dirname = path.dirname(fileURLToPath(import.meta.url));

const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1"].includes(host)) {
  throw new Error(
    `Integration tests write to the database, so they only run against a local one. DATABASE_URL points at "${host || "nothing"}". ` +
      "Start a local Postgres, migrate and seed it, and set DATABASE_URL to it."
  );
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["integration/**/*.test.ts"],
    // src/lib/auth.ts refuses to load without one. Test-only value: the tests
    // sign their own sessions, nobody logs in.
    env: { JWT_SECRET: "integration-test-secret" },
    // One database, shared by every file: one file at a time, so no test sees
    // another's half-finished rows.
    fileParallelism: false,
    // Real round trips to Postgres, and a transaction that waits on a lock.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
});
