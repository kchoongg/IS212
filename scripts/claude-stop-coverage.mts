/**
 * Claude Code Stop hook (.claude/settings.json): when Claude finishes a turn
 * on a branch whose code under src/ has changed, it runs the tests with
 * coverage and the changed-lines check (check-changed-coverage.mts). If a
 * changed line never runs in a test, Claude is sent back to write the test,
 * the same list the CI "Unit tests" check fails a PR on.
 *
 * Stays out of the way otherwise:
 * - No change under src/ other than tests since origin/main: nothing runs.
 * - Nothing changed under src/ since the last check: nothing runs again.
 * - Tests failing: the code is still being written (the team works test-first),
 *   so it does not ask for more tests yet.
 * - Claude was already sent back once and changed nothing: it may stop, and
 *   the list is shown to the person instead, so it never loops.
 *
 * Runs with plain `node` (Node 24 strips the types).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
process.chdir(root);

const COVERAGE_FILE = "coverage/coverage-final.json";
const TEST_FILE = /(\.test\.[tj]sx?$)|(\/__tests__\/)|(\/__mocks__\/)|(^src\/test\/)|(\.d\.ts$)/;

interface Stamp {
  fingerprint: string;
  result: "clean" | "untested" | "tests-failing";
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function done(output?: object): never {
  if (output) process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

const input: { stop_hook_active?: boolean } = (() => {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
})();

if (!existsSync("node_modules/vitest") || !existsSync("scripts/check-changed-coverage.mts")) done();

let base: string;
try {
  base = git("merge-base", "origin/main", "HEAD");
} catch {
  done(); // No origin/main to compare with (fresh clone without fetch, detached state).
}

// Everything under src/ that differs from origin/main, committed or not, plus
// new files git does not track yet.
const changed = [
  ...git("diff", "--name-only", base, "--", "src").split("\n"),
  ...git("ls-files", "--others", "--exclude-standard", "--", "src").split("\n"),
].filter(Boolean);
if (!changed.some((file) => !TEST_FILE.test(file))) done();

// Same code and tests as last time means the same answer.
const hash = createHash("sha256");
hash.update(git("diff", base, "--", "src"));
for (const file of git("ls-files", "--others", "--exclude-standard", "--", "src").split("\n").filter(Boolean)) {
  hash.update(file);
  if (existsSync(file)) hash.update(readFileSync(file));
}
const fingerprint = hash.digest("hex");
const stampFile = path.join(git("rev-parse", "--git-dir"), "claude-changed-coverage.json");
const last: Stamp | null = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, "utf8")) : null;
const save = (result: Stamp["result"]) => writeFileSync(stampFile, JSON.stringify({ fingerprint, result }));

if (last?.fingerprint === fingerprint) {
  if (last.result === "untested" && input.stop_hook_active) {
    done({
      systemMessage:
        "Some changed lines under src/ still never run in a test. CI will fail the PR on them: run `npm run coverage:changed` to see the list.",
    });
  }
  if (last.result !== "untested") done();
}

// A stale report from an earlier run must not be read as this one.
rmSync(COVERAGE_FILE, { force: true });
const tests = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--coverage",
    "--coverage.reporter=json",
    // Only the changed lines matter here; the whole-app minimums are CI's.
    "--coverage.thresholds.statements=0",
    "--coverage.thresholds.branches=0",
    "--coverage.thresholds.functions=0",
    "--coverage.thresholds.lines=0",
  ],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
);
if (tests.status !== 0 || !existsSync(COVERAGE_FILE)) {
  save("tests-failing");
  done();
}

const check = spawnSync(process.execPath, ["scripts/check-changed-coverage.mts"], {
  encoding: "utf8",
  env: { ...process.env, BASE_SHA: base, GITHUB_ACTIONS: "", GITHUB_STEP_SUMMARY: "" },
});
if (check.status === 0) {
  save("clean");
  done();
}

save("untested");
const list = check.stdout
  .split("\n")
  .filter((line) => /^\s+src\//.test(line))
  .join("\n");
done({
  decision: "block",
  reason:
    "These lines this branch adds or changes under src/ never run in a test (CI fails the PR on them):\n" +
    list +
    "\n\nWrite the tests for them, following .claude/skills/write-unit-tests/SKILL.md (check mode, Step 4b), " +
    "then run `npm run test:coverage` and `npm run coverage:changed` to confirm. For a line no test can reach " +
    "(a guard TypeScript needs, a fallback for a value that is always sent), mark it `// v8 ignore next -- <why>` instead. " +
    "Say in your reply which tests you added and which lines you marked.",
});
